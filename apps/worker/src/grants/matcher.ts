import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import {
  grants,
  grantCycles,
  grantRequirements,
  grantMatches,
  teamProfiles,
  type Grant,
  type GrantCycle,
  type GrantRequirement,
  type GrantMatchVerdict,
  type MatchReason,
  type TeamProfile,
} from '@the-tool-pit/db'

/**
 * Eligibility matcher.
 *
 * Deterministic on purpose. Every grant_requirements row names a kind that
 * maps to exactly one team_profiles field, so ruling a team in or out is a
 * plain comparison, not a model call per team per grant. At a few hundred
 * grants times a few hundred profiles an AI call each would be both slow and
 * expensive, and it would give different answers on different days for the
 * same facts. Eligibility has to be reproducible and explainable.
 *
 * Three rules shape everything below.
 *
 *   1. Never silently narrow. A thin profile must never quietly show a team
 *      fewer grants. If we cannot test a blocking requirement because the
 *      profile is missing the field, the verdict is 'missing_info' and we name
 *      the field, which is the whole reason that verdict exists.
 *   2. Never claim more than we know. 'eligible' means every requirement was
 *      testable and every one passed. One untestable row drops it to 'likely'.
 *      Saying "you qualify" and being wrong costs a team an afternoon.
 *   3. Untestable is not the same as unfilled. A 'matching_funds' or
 *      'use_of_funds' row has no corresponding profile field, so there is
 *      nothing the team could type to settle it. Those rows never produce a
 *      'missing_info' verdict, because that would nag a team about a field
 *      that does not exist.
 */

// #region Types

/** What the matcher decides for one (profile, grant, cycle) triple. */
export interface GrantMatchOutcome {
  verdict: GrantMatchVerdict
  /** Ranking within a verdict, roughly 0-90. Never compare across verdicts. */
  score: number
  /** Per-requirement outcomes, stored on the match so the UI can say why. */
  reasons: MatchReason[]
  /**
   * team_profiles field names (camelCase, matching the column properties) the
   * team could fill in to settle an 'unknown'. NOTE this is field names, not
   * requirement kinds: the profile UI aggregates these to tell a team exactly
   * which box to tick, and 'orgType' is actionable where 'org_type' is not.
   */
  missingFields: string[]
}

/** Payload for the grant-match queue. One job recomputes one profile. */
export interface GrantMatchJobPayload {
  /** A profile id, or the '__all__' sentinel to sweep every profile. */
  profileId: string
}

/**
 * One requirement's evaluation, before it is folded into a verdict.
 * `reason` is what gets persisted; the other two fields are matcher internals.
 */
interface Evaluation {
  reason: MatchReason
  /**
   * The team_profiles field that would settle an 'unknown' outcome, or null
   * when nothing the team can type would help (see rule 3 above).
   */
  missingField: string | null
  /**
   * Blocking after kind-level overrides. Differs from reason.isBlocking only
   * where the schema forbids a kind from narrowing the match set.
   */
  blocking: boolean
}

// #endregion

// #region Value comparison

/**
 * Country codes arrive from two directions: profiles default to the ISO-3166
 * alpha-2 'US', but humans type "USA" and "United States" into a text box, and
 * the crawler copies whatever the funder's page says. Fold the handful of
 * spellings we actually see; anything else compares as written, uppercased.
 */
function normaliseCountry(value: string): string {
  const v = value.trim().toUpperCase()
  if (v === 'USA' || v === 'UNITED STATES' || v === 'UNITED STATES OF AMERICA') return 'US'
  if (v === 'CAN' || v === 'CANADA') return 'CA'
  return v
}

function normaliseScalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed.toLowerCase()
  }
  return null
}

function equals(a: string | number | boolean, b: string | number | boolean): boolean {
  // Requirement values come out of jsonb, so a boolean can arrive as the
  // string "true" and a count as "25". Compare loosely on the string form
  // rather than failing a team on a type mismatch we caused ourselves.
  if (typeof a === typeof b) return a === b
  return String(a).toLowerCase() === String(b).toLowerCase()
}

function toList(value: unknown): Array<string | number | boolean> {
  const raw = Array.isArray(value) ? value : [value]
  return raw
    .map((v) => normaliseScalar(v))
    .filter((v): v is string | number | boolean => v !== null)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

type Outcome = 'pass' | 'fail' | 'unknown'

/**
 * Apply one operator. `null` team values never reach here: the caller treats a
 * missing profile field as 'unknown' before comparing, so an empty box is
 * never read as a failure.
 */
function applyOperator(
  operator: string,
  teamValue: string | number | boolean,
  requirementValue: unknown,
): Outcome {
  switch (operator) {
    case 'is': {
      const want = normaliseScalar(requirementValue)
      if (want === null) return 'unknown'
      return equals(teamValue, want) ? 'pass' : 'fail'
    }
    case 'is_not': {
      const want = normaliseScalar(requirementValue)
      if (want === null) return 'unknown'
      return equals(teamValue, want) ? 'fail' : 'pass'
    }
    case 'in': {
      const list = toList(requirementValue)
      if (list.length === 0) return 'unknown'
      return list.some((v) => equals(teamValue, v)) ? 'pass' : 'fail'
    }
    case 'not_in': {
      const list = toList(requirementValue)
      if (list.length === 0) return 'unknown'
      return list.some((v) => equals(teamValue, v)) ? 'fail' : 'pass'
    }
    case 'gte':
    case 'lte': {
      const team = toNumber(teamValue)
      const want = toNumber(requirementValue)
      // A non-numeric threshold is a bad extraction, not a team problem.
      if (team === null || want === null) return 'unknown'
      return operator === 'gte' ? (team >= want ? 'pass' : 'fail') : team <= want ? 'pass' : 'fail'
    }
    case 'exists':
      // Reaching here at all means the profile field is filled in.
      return 'pass'
    default:
      return 'unknown'
  }
}

// #endregion

// #region Profile field resolution

/** Season year for age arithmetic. FIRST seasons are named for the calendar year they end in. */
function seasonYear(now: Date): number {
  return now.getUTCFullYear()
}

/**
 * The team-side value for a requirement kind, plus the profile field that
 * carries it. `value: null` means the team has not filled it in yet.
 *
 * A kind absent from this map has no profile field at all, so it is prose we
 * render and never test (see rule 3). 'demographics' is deliberately in that
 * group: grant_requirements.value is typed as a scalar or an array, so it has
 * nowhere to say WHICH demographic percentage it means, and team_profiles
 * documents demographics as widening the match set only, never narrowing it.
 */
function resolveProfileValue(
  kind: string,
  profile: TeamProfile,
  now: Date,
): { field: string; value: string | number | boolean | null } | null {
  switch (kind) {
    case 'org_type':
      // 'unknown' is the column default, so it means unanswered, not a value.
      return { field: 'orgType', value: profile.orgType === 'unknown' ? null : profile.orgType }
    case 'fiscal_sponsor_ok': {
      // The requirement asks whether applying through a fiscal sponsor is
      // acceptable, so the team-side fact is whether this team relies on one.
      // A named sponsor settles it whatever the org type says.
      if (profile.fiscalSponsorName && profile.fiscalSponsorName.trim() !== '') {
        return { field: 'fiscalSponsorName', value: true }
      }
      if (profile.orgType !== 'unknown') {
        return { field: 'fiscalSponsorName', value: profile.orgType === 'fiscal_sponsor' }
      }
      return { field: 'orgType', value: null }
    }
    case 'country':
      return { field: 'country', value: profile.country ? normaliseCountry(profile.country) : null }
    case 'region':
      return { field: 'region', value: profile.region?.trim() || null }
    case 'program':
      return { field: 'program', value: profile.program || null }
    case 'team_age_years':
      return {
        field: 'rookieYear',
        value: profile.rookieYear == null ? null : seasonYear(now) - profile.rookieYear,
      }
    case 'rookie_only':
      // A rookie is a team in its first season, so age 0 in the season its
      // rookie year names. Teams that have not said cannot be tested.
      return {
        field: 'rookieYear',
        value: profile.rookieYear == null ? null : seasonYear(now) - profile.rookieYear <= 0,
      }
    case 'title_i':
      // Nullable boolean: null is "we have not asked them yet", not "no".
      return { field: 'titleOne', value: profile.titleOne ?? null }
    case 'school_type':
      return {
        field: 'schoolType',
        value: profile.schoolType === 'unknown' ? null : profile.schoolType,
      }
    case 'student_count':
      return { field: 'studentCount', value: profile.studentCount ?? null }
    default:
      return null
  }
}

/** Kinds that may never rule a team out, whatever the row says. */
const NEVER_BLOCKING_KINDS = new Set(['demographics'])

// #endregion

// #region Scope gates

/**
 * Programme and geography live on the grant itself rather than in requirement
 * rows, so they are checked first. They are the cheapest and hardest gates:
 * a Michigan-only grant is not a maybe for an Ohio team.
 */
function evaluateScope(grant: Grant, profile: TeamProfile): Evaluation[] {
  const out: Evaluation[] = []

  // --- Programme ---
  const programs = grant.programs ?? []
  const anyProgram = programs.length === 0 || programs.includes('any')
  out.push({
    reason: {
      requirementId: 'scope:program',
      kind: 'program',
      label: anyProgram
        ? 'Open to any FIRST programme'
        : `Funds ${programs.map((p) => p.toUpperCase()).join(', ')} teams`,
      outcome: anyProgram || programs.includes(profile.program) ? 'pass' : 'fail',
      isBlocking: true,
    },
    missingField: null,
    blocking: true,
  })

  // --- Country ---
  if (grant.geoScope !== 'international') {
    const countries = (grant.countries ?? []).map(normaliseCountry)
    const teamCountry = profile.country ? normaliseCountry(profile.country) : null
    const outcome: Outcome =
      countries.length === 0 ? 'unknown' : teamCountry === null ? 'unknown' : countries.includes(teamCountry) ? 'pass' : 'fail'
    out.push({
      reason: {
        requirementId: 'scope:country',
        kind: 'country',
        label: countries.length ? `Open to teams in ${countries.join(', ')}` : 'Country not stated on the listing',
        outcome,
        isBlocking: true,
      },
      // Only a missing profile country is something the team can fix. A
      // listing with no countries is our data gap, so we do not nag them.
      missingField: countries.length > 0 && teamCountry === null ? 'country' : null,
      blocking: countries.length > 0,
    })
  }

  // --- Region, for anything narrower than national ---
  if (grant.geoScope === 'state' || grant.geoScope === 'region' || grant.geoScope === 'local') {
    const regions = (grant.regions ?? []).map((r) => r.trim().toUpperCase()).filter(Boolean)
    const teamRegion = profile.region?.trim().toUpperCase() || null

    if (regions.length === 0) {
      // The schema requires regions on a narrow-scope grant precisely so this
      // cannot happen. When it does, the listing is unusable for matching:
      // say so on the match rather than either dropping the grant (a silent
      // cap) or letting it through as a pass (a wrong answer).
      out.push({
        reason: {
          requirementId: 'scope:region',
          kind: 'region',
          label: `Limited to a ${grant.geoScope} area, but the listing does not say which${grant.localityNote ? `: ${grant.localityNote}` : ''}`,
          outcome: 'unknown',
          isBlocking: false,
        },
        missingField: null,
        blocking: false,
      })
    } else {
      out.push({
        reason: {
          requirementId: 'scope:region',
          kind: 'region',
          label: `Open to teams in ${regions.join(', ')}`,
          outcome: teamRegion === null ? 'unknown' : regions.includes(teamRegion) ? 'pass' : 'fail',
          isBlocking: true,
        },
        missingField: teamRegion === null ? 'region' : null,
        blocking: true,
      })
    }
  }

  return out
}

// #endregion

// #region Scoring

/**
 * Rank within a verdict. Three inputs, all from the task the team faces:
 * how much money is on offer, how much work the application is, and how long
 * they have. Deliberately NOT a probability, and never comparable across
 * verdicts, so an 'eligible' $500 grant still sorts above a 'likely' $50k one.
 */
function scoreMatch(grant: Grant, cycle: GrantCycle | null, now: Date): number {
  // --- Award size, 0-40, log scaled. The step from $500 to $5,000 matters far
  // more to a team than the step from $45,000 to $50,000. ---
  const amount = grant.awardMax ?? grant.awardMin ?? null
  const awardScore =
    amount === null || amount <= 0
      ? 12 // unstated: mid-table, neither promoted nor buried
      : Math.min(1, Math.log10(amount) / Math.log10(50_000)) * 40

  // --- Effort, 0-25. A low-effort form a student can finish in an evening is
  // worth more than a high-effort one nobody on the team has time for. ---
  const effortScore =
    grant.effortLevel === 'low' ? 25 : grant.effortLevel === 'medium' ? 15 : grant.effortLevel === 'high' ? 5 : 12

  // --- Deadline, 0-25. Peak value is a month out: close enough to act on,
  // far enough to actually write. Inside a week the form is often not
  // realistic, so it sorts below a comfortable deadline rather than above it. ---
  let deadlineScore: number
  if (!cycle?.deadlineAt) {
    deadlineScore = 15 // rolling or unknown: always actionable, never urgent
  } else {
    const days = (cycle.deadlineAt.getTime() - now.getTime()) / 86_400_000
    if (days < 0) deadlineScore = 0
    else if (days <= 7) deadlineScore = 8
    else if (days <= 30) deadlineScore = 25
    else if (days <= 90) deadlineScore = 20
    else deadlineScore = 12
  }
  // Carried-over dates are an expectation, not a published deadline, so they
  // must not outrank a date a human confirmed.
  if (cycle?.isEstimated) deadlineScore *= 0.5

  return Math.round((awardScore + effortScore + deadlineScore) * 10) / 10
}

// #endregion

// #region The matcher

/** Order missing fields by how much of the profile they unlock, then alphabetically. */
const MISSING_FIELD_PRIORITY = [
  'orgType',
  'country',
  'region',
  'schoolType',
  'titleOne',
  'rookieYear',
  'studentCount',
  'fiscalSponsorName',
  'program',
]

function sortMissingFields(fields: Iterable<string>): string[] {
  return [...new Set(fields)].sort((a, b) => {
    const ia = MISSING_FIELD_PRIORITY.indexOf(a)
    const ib = MISSING_FIELD_PRIORITY.indexOf(b)
    if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    return a.localeCompare(b)
  })
}

/**
 * Decide whether one team profile can apply for one grant.
 *
 * Pure and synchronous: no DB, no network, no clock beyond `now`, so it is
 * safe to call in a tight loop and trivial to test.
 */
export function matchProfileToGrant(
  profile: TeamProfile,
  grant: Grant,
  requirements: GrantRequirement[],
  cycle: GrantCycle | null,
  now: Date = new Date(),
): GrantMatchOutcome {
  const evaluations: Evaluation[] = evaluateScope(grant, profile)

  const ordered = [...requirements].sort((a, b) => a.sortOrder - b.sortOrder)
  for (const req of ordered) {
    const blocking = req.isBlocking && !NEVER_BLOCKING_KINDS.has(req.kind)
    const resolved = resolveProfileValue(req.kind, profile, now)

    if (!resolved) {
      // No profile field carries this fact, so it is prose. We keep the row's
      // own isBlocking on the reason (the team should still read it) but never
      // let it produce 'missing_info', because there is no box to fill.
      evaluations.push({
        reason: { requirementId: req.id, kind: req.kind, label: req.label, outcome: 'unknown', isBlocking: req.isBlocking },
        missingField: null,
        blocking: false,
      })
      continue
    }

    if (resolved.value === null) {
      evaluations.push({
        reason: { requirementId: req.id, kind: req.kind, label: req.label, outcome: 'unknown', isBlocking: req.isBlocking },
        missingField: resolved.field,
        blocking,
      })
      continue
    }

    evaluations.push({
      reason: {
        requirementId: req.id,
        kind: req.kind,
        label: req.label,
        outcome: applyOperator(req.operator, resolved.value, req.value),
        isBlocking: req.isBlocking,
      },
      missingField: null,
      blocking,
    })
  }

  const missingFields = sortMissingFields(
    evaluations
      .filter((e) => e.reason.outcome === 'unknown' && e.missingField !== null)
      .map((e) => e.missingField as string),
  )

  // Verdict precedence. Order matters and matches the product rules:
  // a hard fail beats everything, an unfilled blocking field is the prompt to
  // finish the profile, and anything else we could not fully verify is only
  // ever 'likely'.
  let verdict: GrantMatchVerdict
  if (evaluations.some((e) => e.blocking && e.reason.outcome === 'fail')) {
    verdict = 'ineligible'
  } else if (evaluations.some((e) => e.blocking && e.reason.outcome === 'unknown' && e.missingField !== null)) {
    verdict = 'missing_info'
  } else if (evaluations.some((e) => e.reason.outcome !== 'pass')) {
    // A non-blocking failure, or a requirement nobody can test. Either way we
    // are not going to tell a team they definitely qualify.
    verdict = 'likely'
  } else {
    verdict = 'eligible'
  }

  return {
    verdict,
    score: scoreMatch(grant, cycle, now),
    reasons: evaluations.map((e) => e.reason),
    missingFields,
  }
}

// #endregion

// #region The job

/** Cycle states a team can still act on. */
const ACTIONABLE_CYCLE_STATUSES = ['open', 'upcoming']

/**
 * Pick the cycle a match should hang off: the open one if there is one, else
 * the soonest upcoming. Ties break on the earlier deadline so the ranking is
 * stable between runs.
 */
function pickCycle(cycles: GrantCycle[]): GrantCycle | null {
  const actionable = cycles.filter((c) => ACTIONABLE_CYCLE_STATUSES.includes(c.status))
  if (actionable.length === 0) return null
  const open = actionable.filter((c) => c.status === 'open')
  const pool = open.length > 0 ? open : actionable
  return [...pool].sort((a, b) => {
    const at = a.deadlineAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bt = b.deadlineAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    if (at !== bt) return at - bt
    return a.cycleYear - b.cycleYear
  })[0]
}

/**
 * Recompute every match for one team profile.
 *
 * Scope: published grants that a team can still act on, which is either a
 * grant with an open or upcoming cycle, or a rolling grant that takes
 * applications whenever. Rolling grants often carry no cycle rows at all, so
 * filtering on cycles alone would drop them, and dropping a whole class of
 * grant without saying so is exactly the silent cap this product does not do.
 * Both bucket sizes go in the summary log.
 *
 * 'ineligible' verdicts are not stored. They are the answer for most of the
 * catalogue and writing them would mean a row per profile per grant for no
 * gain; a grant a team cannot get is simply absent from their list.
 */
export async function processGrantMatchJob(payload: GrantMatchJobPayload): Promise<void> {
  const db = getDb()

  // Sweep sentinel, same shape as the freshness pass. Kept inline rather than
  // fanning out onto the queue so this module has no queue dependency.
  if (payload.profileId === '__all__') {
    const profiles = await db.select({ id: teamProfiles.id }).from(teamProfiles)
    console.log(`[grant-match] sweeping ${profiles.length} profiles`)
    for (const p of profiles) {
      await processGrantMatchJob({ profileId: p.id })
    }
    return
  }

  const [profile] = await db.select().from(teamProfiles).where(eq(teamProfiles.id, payload.profileId)).limit(1)
  if (!profile) {
    console.warn(`[grant-match] profile ${payload.profileId} not found, nothing to do`)
    return
  }

  const now = new Date()

  const publishedGrants = await db.select().from(grants).where(eq(grants.status, 'published'))
  if (publishedGrants.length === 0) {
    console.log('[grant-match] no published grants, nothing to match')
    return
  }

  const grantIds = publishedGrants.map((g) => g.id)
  const allCycles = await db.select().from(grantCycles).where(inArray(grantCycles.grantId, grantIds))
  const allRequirements = await db
    .select()
    .from(grantRequirements)
    .where(inArray(grantRequirements.grantId, grantIds))

  const cyclesByGrant = new Map<string, GrantCycle[]>()
  for (const c of allCycles) {
    const list = cyclesByGrant.get(c.grantId)
    if (list) list.push(c)
    else cyclesByGrant.set(c.grantId, [c])
  }
  const requirementsByGrant = new Map<string, GrantRequirement[]>()
  for (const r of allRequirements) {
    const list = requirementsByGrant.get(r.grantId)
    if (list) list.push(r)
    else requirementsByGrant.set(r.grantId, [r])
  }

  const stats = {
    considered: 0,
    withCycle: 0,
    rollingNoCycle: 0,
    skippedNoOpenCycle: 0,
    eligible: 0,
    likely: 0,
    missingInfo: 0,
    ineligible: 0,
  }

  /** Keys we kept this run, as `<grantId>:<cycleId ?? 'null'>`. */
  const kept = new Set<string>()

  for (const grant of publishedGrants) {
    const cycle = pickCycle(cyclesByGrant.get(grant.id) ?? [])
    if (!cycle && grant.deadlineType !== 'rolling') {
      stats.skippedNoOpenCycle++
      continue
    }
    if (cycle) stats.withCycle++
    else stats.rollingNoCycle++
    stats.considered++

    const outcome = matchProfileToGrant(profile, grant, requirementsByGrant.get(grant.id) ?? [], cycle, now)

    if (outcome.verdict === 'ineligible') {
      stats.ineligible++
      continue
    }
    if (outcome.verdict === 'eligible') stats.eligible++
    else if (outcome.verdict === 'likely') stats.likely++
    else stats.missingInfo++

    kept.add(`${grant.id}:${cycle?.id ?? 'null'}`)

    const values = {
      profileId: profile.id,
      grantId: grant.id,
      cycleId: cycle?.id ?? null,
      verdict: outcome.verdict,
      score: outcome.score,
      reasons: outcome.reasons,
      missingFields: outcome.missingFields,
      computedAt: now,
    }
    // notifiedAt and dismissedAt are deliberately absent from the update set.
    // The alert sender owns notifiedAt, and re-running the matcher must never
    // resurface a match the team has already dismissed.
    const updateSet = {
      verdict: values.verdict,
      score: values.score,
      reasons: values.reasons,
      missingFields: values.missingFields,
      computedAt: values.computedAt,
    }

    if (cycle) {
      await db
        .insert(grantMatches)
        .values(values)
        .onConflictDoUpdate({
          target: [grantMatches.profileId, grantMatches.grantId, grantMatches.cycleId],
          set: updateSet,
        })
    } else {
      // Postgres treats NULLs as distinct in a unique index, so the
      // (profile, grant, cycle) constraint does NOT dedupe rolling grants with
      // a null cycle. Left to ON CONFLICT this would insert a fresh duplicate
      // row on every pass. Read then write instead.
      const [existing] = await db
        .select({ id: grantMatches.id })
        .from(grantMatches)
        .where(
          and(
            eq(grantMatches.profileId, profile.id),
            eq(grantMatches.grantId, grant.id),
            isNull(grantMatches.cycleId),
          ),
        )
        .limit(1)
      if (existing) {
        await db.update(grantMatches).set(updateSet).where(eq(grantMatches.id, existing.id))
      } else {
        await db.insert(grantMatches).values(values)
      }
    }
  }

  // Clear matches that no longer apply: the grant was unpublished, its cycle
  // closed, or the team's profile changed enough to rule them out. A dismissed
  // row is the team's own decision and is never touched.
  //
  // The stale set is worked out in JS rather than as a NOT IN over a composite
  // key, because the key is (grantId, cycleId) with a nullable half and SQL
  // NULL comparison would quietly spare every rolling-grant row.
  const existingRows = await db
    .select({ id: grantMatches.id, grantId: grantMatches.grantId, cycleId: grantMatches.cycleId })
    .from(grantMatches)
    .where(and(eq(grantMatches.profileId, profile.id), isNull(grantMatches.dismissedAt)))
  const staleIds = existingRows
    .filter((row) => !kept.has(`${row.grantId}:${row.cycleId ?? 'null'}`))
    .map((row) => row.id)
  if (staleIds.length > 0) {
    await db.delete(grantMatches).where(inArray(grantMatches.id, staleIds))
  }

  console.log(
    `[grant-match] profile=${profile.id} team=${profile.program}${profile.teamNumber} ` +
      `considered=${stats.considered} (cycle=${stats.withCycle} rolling=${stats.rollingNoCycle}) ` +
      `skipped_no_open_cycle=${stats.skippedNoOpenCycle} ` +
      `eligible=${stats.eligible} likely=${stats.likely} missing_info=${stats.missingInfo} ` +
      `ineligible=${stats.ineligible} cleared=${staleIds.length}`,
  )
}

// #endregion
