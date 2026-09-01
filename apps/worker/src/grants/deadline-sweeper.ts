/**
 * Deadline sweeper: work out which reminders are owed right now and queue them.
 *
 * Runs on a schedule and is safe to run as often as you like. It re-derives
 * every reminder that is currently owed and lets the unique index on
 * grant_alerts.dedupeKey decide which of them are actually new, so a second
 * pass on the same day writes nothing. Nothing here sends an email; the drain
 * in ./alerts.ts does that.
 *
 * TWO RULES SHAPE THIS FILE.
 *
 * 1. AN ESTIMATED DATE NEVER PRODUCES A REMINDER. grant_cycles.isEstimated
 *    means the dates were carried over from a previous year as an expectation,
 *    not published by the funder. Telling a team "14 days left" on a date we
 *    inferred is the exact failure this vertical is built to avoid: a wrong
 *    deadline is worse than no deadline. Estimated cycles are counted in the
 *    stats so the gap is visible rather than silent.
 *
 * 2. ONE REMINDER PER PERSON PER OFFSET, whatever the source. A user who both
 *    watches a grant and matches it is one person with one inbox. The dedupe
 *    key is `deadline:<cycleId>:<userId>:<daysBefore>` and deliberately does
 *    not name whether the watch or the match produced it, so the second source
 *    collides with the first and writes nothing.
 *
 * WHY ONE BUCKET AT A TIME
 * A team that discovers a grant five days before it shuts must not be sent
 * three emails at once for the 30, 14 and 3 day offsets. So each pass picks the
 * single tightest offset the deadline has already entered (the smallest offset
 * that is still at or above the real days remaining) and queues only that.
 * Later passes queue the smaller offsets as their turn comes, and the dedupe
 * key stops any of them repeating.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  getDb,
  grantCycles,
  grantFunders,
  grantMatches,
  grantWatches,
  grants,
  teamProfileMembers,
  teamProfiles,
  type Grant,
  type GrantCycle,
  type MatchReason,
} from '@the-tool-pit/db'
import { enqueueGrantAlert, grantUrl, type DeadlineAlertPayload, type NewMatchAlertPayload } from './alerts.js'
import { pickNextCycle } from './cadence.js'

// #region offsets

/**
 * Used for a match-derived reminder, where there is no watch row to read an
 * offset from. Same default as grant_watches.remindDaysBefore, kept in step by
 * hand because the column default lives in the schema package.
 */
export const DEFAULT_REMIND_DAYS = [30, 14, 3]

/** Most offsets one watch may carry. A guard on the loop, not a product limit. */
const MAX_OFFSETS = 6

const MS_PER_DAY = 86_400_000

/**
 * Clean an offset list read out of the database.
 *
 * The API route validates on the way in, but a sweeper that trusts stored data
 * blindly is one bad row away from queueing a thousand alerts. Whole positive
 * days only, deduped, largest first, and bounded.
 */
export function normaliseOffsets(raw: readonly number[] | null | undefined): number[] {
  const cleaned = (raw ?? DEFAULT_REMIND_DAYS)
    .filter((d) => Number.isInteger(d) && d > 0 && d <= 365)
    .sort((a, b) => b - a)
  const unique = [...new Set(cleaned)]
  return unique.length > 0 ? unique.slice(0, MAX_OFFSETS) : [...DEFAULT_REMIND_DAYS]
}

/** Whole days from now until `at`, rounded up. Negative once the date has gone. */
export function daysUntil(at: Date, now: Date): number {
  return Math.ceil((at.getTime() - now.getTime()) / MS_PER_DAY)
}

/**
 * The single offset that is owed right now, or null when none is.
 *
 * Null means either the deadline is further out than the widest offset (too
 * early to say anything) or it has already passed (too late to be useful).
 */
export function pickReminderOffset(daysLeft: number, offsets: number[]): number | null {
  if (daysLeft < 0) return null
  const entered = offsets.filter((d) => d >= daysLeft)
  if (entered.length === 0) return null
  return Math.min(...entered)
}

// #endregion

// #region shared lookups

/** Why a cycle cannot carry a reminder. Every one of these is counted. */
type CycleSkipReason = 'no_cycle' | 'no_deadline' | 'estimated' | 'unverified' | 'passed'

/** A cycle a reminder may legitimately be built on, or the reason it may not. */
type CycleCheck = { ok: true; cycle: GrantCycle; deadlineAt: Date } | { ok: false; reason: CycleSkipReason }

function usableCycle(cycle: GrantCycle | null, now: Date): CycleCheck {
  if (!cycle) return { ok: false, reason: 'no_cycle' }
  if (!cycle.deadlineAt) return { ok: false, reason: 'no_deadline' }
  // Rule 1. Our inference is not the funder's word, so it never triggers a
  // countdown email.
  if (cycle.isEstimated) return { ok: false, reason: 'estimated' }
  // And neither is our scrape. isEstimated alone is not enough of a screen:
  // it only marks dates we carried over ourselves, so a date read straight off
  // a funder's page passed it while no person had ever looked at it. An email
  // saying "3 days left to apply" is the loudest surface this vertical has,
  // and a team that misses a real deadline because we invented a wrong one
  // does not get a second go. So the cycle must carry a human confirmation.
  // Every path that creates a cycle with dates stamps verifiedAt (admin edit,
  // candidate approval, and applying a date change in the review queue), so
  // this costs no legitimate reminder.
  if (!cycle.verifiedAt) return { ok: false, reason: 'unverified' }
  if (cycle.deadlineAt.getTime() < now.getTime()) return { ok: false, reason: 'passed' }
  return { ok: true, cycle, deadlineAt: cycle.deadlineAt }
}

function buildDeadlinePayload(
  grant: Grant,
  funderName: string | null,
  cycle: GrantCycle,
  deadlineAt: Date,
  daysBefore: number,
): DeadlineAlertPayload {
  return {
    grantName: grant.name,
    grantUrl: grantUrl(grant.slug),
    funderName,
    deadlineAt: deadlineAt.toISOString(),
    deadlineNote: cycle.deadlineNote,
    applicationUrl: grant.applicationUrl,
    // The cycle's own human confirmation, not the parent listing's. The email
    // says how fresh THESE dates are, and the listing being verified says
    // nothing about whether anyone re-read the deadline.
    verifiedAt: cycle.verifiedAt?.toISOString() ?? null,
    daysBefore,
  }
}

// #endregion

// #region stats

export interface GrantDeadlineSweepStats {
  /** Watch rows examined. */
  watches: number
  /** Match rows examined (non-dismissed, eligible or likely). */
  matches: number
  /** Deadline alerts newly queued. Re-runs on the same day add nothing. */
  deadlineQueued: number
  /** new_match alerts newly queued. */
  newMatchQueued: number
  /** Deadline reminders not queued, by reason. Every one of these is a gap. */
  skipped: {
    /** The grant has no cycle to remind on at all. */
    noCycle: number
    /** The cycle exists but the funder has published no closing date. */
    noDeadline: number
    /** Rule 1: the date is our inference, so no countdown was sent. */
    estimatedCycle: number
    /**
     * The date came off a page but no person has confirmed it. Watch this one:
     * a number that climbs means the review queue is not being worked, and
     * every row in it is a team not being told about a real deadline.
     */
    unverifiedCycle: number
    /** The deadline has already gone. */
    passed: number
    /** Too early: further out than the widest offset the user asked for. */
    tooEarly: number
    /** The grant is no longer published, so it has no public page to link to. */
    notPublished: number
  }
  /** Matches whose team profile has no members, so there is nobody to tell. */
  matchesWithNoMembers: number
}

function emptyStats(): GrantDeadlineSweepStats {
  return {
    watches: 0,
    matches: 0,
    deadlineQueued: 0,
    newMatchQueued: 0,
    skipped: { noCycle: 0, noDeadline: 0, estimatedCycle: 0, unverifiedCycle: 0, passed: 0, tooEarly: 0, notPublished: 0 },
    matchesWithNoMembers: 0,
  }
}

function countSkip(stats: GrantDeadlineSweepStats, reason: CycleSkipReason): void {
  switch (reason) {
    case 'no_cycle':
      stats.skipped.noCycle++
      break
    case 'no_deadline':
      stats.skipped.noDeadline++
      break
    case 'estimated':
      stats.skipped.estimatedCycle++
      break
    case 'unverified':
      stats.skipped.unverifiedCycle++
      break
    case 'passed':
      stats.skipped.passed++
      break
  }
}

// #endregion

// #region sweep

export interface GrantDeadlineSweepOptions {
  now?: Date
}

/**
 * One sweep over watches and matches.
 *
 * Loads in bulk rather than per row: at a few hundred grants and a few thousand
 * watches this is four queries and a couple of maps, where the naive shape is a
 * query per watch per pass.
 */
export async function processGrantDeadlineSweepJob(
  opts: GrantDeadlineSweepOptions = {},
): Promise<GrantDeadlineSweepStats> {
  const db = getDb()
  const now = opts.now ?? new Date()
  const stats = emptyStats()

  const watches = await db.select().from(grantWatches)

  // 'missing_info' and 'ineligible' are never emailed. The first is a prompt to
  // finish a profile, which belongs on the profile page and not in an inbox,
  // and the second is not stored at all.
  const matches = await db
    .select()
    .from(grantMatches)
    .where(and(isNull(grantMatches.dismissedAt), inArray(grantMatches.verdict, ['eligible', 'likely'])))

  stats.watches = watches.length
  stats.matches = matches.length

  const grantIds = [...new Set([...watches.map((w) => w.grantId), ...matches.map((m) => m.grantId)])]
  if (grantIds.length === 0) {
    console.log('[grant-deadlines] nothing watched or matched, nothing to sweep')
    return stats
  }

  // Only published grants. A grant pulled back to pending because its facts
  // stopped checking out has no public page, so an email about it would link
  // into a 404 and assert a deadline nobody stands behind any more.
  const grantRows = await db
    .select({ grant: grants, funderName: grantFunders.name })
    .from(grants)
    .leftJoin(grantFunders, eq(grantFunders.id, grants.funderId))
    .where(and(inArray(grants.id, grantIds), eq(grants.status, 'published')))

  const grantById = new Map(grantRows.map((r) => [r.grant.id, r]))

  const cycleRows = await db.select().from(grantCycles).where(inArray(grantCycles.grantId, grantIds))
  const cyclesByGrant = new Map<string, GrantCycle[]>()
  const cycleById = new Map<string, GrantCycle>()
  for (const c of cycleRows) {
    cycleById.set(c.id, c)
    const list = cyclesByGrant.get(c.grantId)
    if (list) list.push(c)
    else cyclesByGrant.set(c.grantId, [c])
  }

  // #region watches

  for (const watch of watches) {
    const found = grantById.get(watch.grantId)
    if (!found) {
      stats.skipped.notPublished++
      continue
    }

    const check = usableCycle(pickNextCycle(cyclesByGrant.get(watch.grantId) ?? [], now), now)
    if (!check.ok) {
      countSkip(stats, check.reason)
      continue
    }

    const offsets = normaliseOffsets(watch.remindDaysBefore)
    const daysLeft = daysUntil(check.deadlineAt, now)
    const offset = pickReminderOffset(daysLeft, offsets)
    if (offset === null) {
      stats.skipped.tooEarly++
      continue
    }

    const id = await enqueueGrantAlert({
      userId: watch.userId,
      kind: 'deadline',
      grantId: found.grant.id,
      cycleId: check.cycle.id,
      dedupeKey: `deadline:${check.cycle.id}:${watch.userId}:${offset}`,
      payload: buildDeadlinePayload(found.grant, found.funderName, check.cycle, check.deadlineAt, offset),
    })
    if (id) stats.deadlineQueued++
  }

  // #endregion

  // #region matches

  const profileIds = [...new Set(matches.map((m) => m.profileId))]
  if (profileIds.length === 0) {
    logSweep(stats)
    return stats
  }

  const profiles = await db.select().from(teamProfiles).where(inArray(teamProfiles.id, profileIds))
  const profileById = new Map(profiles.map((p) => [p.id, p]))

  // Members, not user_teams. Editing a team profile is a real permission and
  // these are the people who hold it, so they are the people who should hear
  // about money the profile qualifies for.
  const memberRows = await db
    .select({ profileId: teamProfileMembers.profileId, userId: teamProfileMembers.userId })
    .from(teamProfileMembers)
    .where(inArray(teamProfileMembers.profileId, profileIds))

  const membersByProfile = new Map<string, string[]>()
  for (const m of memberRows) {
    const list = membersByProfile.get(m.profileId)
    if (list) list.push(m.userId)
    else membersByProfile.set(m.profileId, [m.userId])
  }

  for (const match of matches) {
    const found = grantById.get(match.grantId)
    if (!found) {
      stats.skipped.notPublished++
      continue
    }

    const members = membersByProfile.get(match.profileId) ?? []
    if (members.length === 0) {
      // Nobody to tell. notifiedAt is deliberately left null so the match is
      // announced the day someone joins the profile, rather than being marked
      // as told to an empty room.
      stats.matchesWithNoMembers++
      continue
    }

    const profile = profileById.get(match.profileId)
    const teamLabel = profile ? `${profile.program.toUpperCase()} team ${profile.teamNumber}` : null

    const cycle = match.cycleId ? (cycleById.get(match.cycleId) ?? null) : null
    const check = usableCycle(cycle, now)

    // --- new_match: once per match, on the first sweep that sees it ---
    if (!match.notifiedAt) {
      const reasons = (match.reasons ?? []) as MatchReason[]
      const payload: NewMatchAlertPayload = {
        grantName: found.grant.name,
        grantUrl: grantUrl(found.grant.slug),
        funderName: found.funderName,
        teamLabel,
        verdict: match.verdict,
        awardMin: found.grant.awardMin,
        awardMax: found.grant.awardMax,
        awardCurrency: found.grant.awardCurrency,
        // A date only when the funder published it. An estimated cycle is
        // still a real match worth telling a team about, it just gets told
        // without a date attached.
        deadlineAt: check.ok ? check.deadlineAt.toISOString() : null,
        deadlineNote: check.ok ? check.cycle.deadlineNote : null,
        passedReasons: reasons.filter((r) => r.outcome === 'pass').map((r) => r.label),
        unknownReasons: reasons.filter((r) => r.outcome === 'unknown').map((r) => r.label),
      }

      for (const userId of members) {
        const id = await enqueueGrantAlert({
          userId,
          kind: 'new_match',
          grantId: match.grantId,
          cycleId: match.cycleId,
          dedupeKey: `new_match:${match.id}:${userId}`,
          payload,
        })
        if (id) stats.newMatchQueued++
      }

      // Stamped only after the rows exist. If the insert above throws, the
      // match stays unnotified and the next sweep tries again; the dedupe key
      // makes the retry free.
      await db.update(grantMatches).set({ notifiedAt: new Date() }).where(eq(grantMatches.id, match.id))
    }

    // --- deadline reminders for the matched cycle ---
    if (!check.ok) {
      countSkip(stats, check.reason)
      continue
    }

    const daysLeft = daysUntil(check.deadlineAt, now)
    const offset = pickReminderOffset(daysLeft, DEFAULT_REMIND_DAYS)
    if (offset === null) {
      stats.skipped.tooEarly++
      continue
    }

    const payload = buildDeadlinePayload(found.grant, found.funderName, check.cycle, check.deadlineAt, offset)
    for (const userId of members) {
      // Collides by design with the watch-derived key above when the same
      // person is watching the same cycle, so they get one email.
      const id = await enqueueGrantAlert({
        userId,
        kind: 'deadline',
        grantId: match.grantId,
        cycleId: check.cycle.id,
        dedupeKey: `deadline:${check.cycle.id}:${userId}:${offset}`,
        payload,
      })
      if (id) stats.deadlineQueued++
    }
  }

  // #endregion

  logSweep(stats)
  return stats
}

/**
 * One summary line per sweep, with every skip reason on it. A team that never
 * gets a reminder because every cycle it cares about is estimated is a real
 * coverage gap, and it should be readable here rather than inferred from
 * silence.
 */
function logSweep(stats: GrantDeadlineSweepStats): void {
  const s = stats.skipped
  console.log(
    `[grant-deadlines] watches=${stats.watches} matches=${stats.matches} ` +
      `queued deadline=${stats.deadlineQueued} new_match=${stats.newMatchQueued} | ` +
      `skipped estimated=${s.estimatedCycle} unverified=${s.unverifiedCycle} ` +
      `noDeadline=${s.noDeadline} noCycle=${s.noCycle} ` +
      `passed=${s.passed} tooEarly=${s.tooEarly} notPublished=${s.notPublished} ` +
      `noMembers=${stats.matchesWithNoMembers}`,
  )
}

// #endregion
