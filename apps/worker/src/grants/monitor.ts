/**
 * Grant MONITOR job: re-read one grant's page and notice when a date moved.
 *
 * The shape of this job is the whole cost control for the vertical:
 *
 *   fetch -> strip -> hash -> hash unchanged? stop.
 *                          -> hash changed?   extract, diff, file changes.
 *
 * Most passes stop at the hash, which is why a few hundred watched grants cost
 * a few hundred page loads and almost no model calls. ./strip.ts is what makes
 * that true; if it ever regresses, this job quietly turns into one Claude call
 * per grant per pass and the account runs dry.
 *
 * The rule this file must never break: it does not mutate a published grant
 * and it does not mutate an existing cycle. It writes snapshots, it advances
 * crawl bookkeeping (lastCheckedAt, contentHash, checkFailureCount), and it
 * files grant_changes rows for a human. grants.verifiedAt and
 * grantCycles.verifiedAt are human confirmations and nothing here touches
 * them. A wrong deadline is worse than no deadline.
 *
 * There are NO writes here that add public data. Not one. A year the grant
 * has no cycle row for is proposed as pending changes like everything else;
 * see the else-if in processGrantMonitorJob. The admin change queue is the
 * only route a scraped date takes onto a published listing.
 */
import { ne } from 'drizzle-orm'
import { and, desc, eq, getDb, grantChanges, grantCycles, grants, grantSnapshots, grantWatches } from '@the-tool-pit/db'
import type { ExtractedGrantFields, Grant, GrantCycle } from '@the-tool-pit/db'
import { politeFetch } from '../connectors/base.js'
import { hashContent, stripToMainContent } from './strip.js'
import { extractGrantFields, type GrantExtractionResult } from './extract.js'
import { deriveCycleStatus } from './cadence.js'
import { enqueueGrantAlert, grantUrl } from './alerts.js'

/**
 * Payload for the grant-monitor queue. Kept here rather than in
 * @the-tool-pit/types so this vertical can land without touching the shared
 * package, the same call ./enrich.ts and ./discover.ts made.
 */
export interface GrantMonitorPayload {
  grantId: string
}

export interface GrantMonitorOutcome {
  grantId: string
  /** Null only when the grant row was gone by the time the job ran. */
  snapshotId: string | null
  /** False when the stripped content hashed the same as last pass. */
  changed: boolean
  httpStatus: number | null
  /** grant_changes rows written by this pass. */
  changesFiled: number
  /** True when the narrow additive cycle insert fired. */
  /** Which extraction pass ran, or why none did. */
  extraction: 'skipped' | 'none' | 'deterministic' | 'ai'
  /**
   * Anything that bounded this pass: a truncated page, a skipped AI call, a
   * confidence too low to diff on. Surfaced, never dropped, because a monitor
   * that silently stops looking reads exactly like one that found nothing.
   */
  notes: string[]
  error: string | null
}

// #region tuning

/** How much stripped text to keep on the snapshot so a reviewer can diff it. */
const SNAPSHOT_TEXT_LIMIT = 20_000

/**
 * Below this the extractor is guessing, and a guess filed as a change costs a
 * reviewer more time than it saves. extract.ts documents the same threshold.
 */
const MIN_DIFF_CONFIDENCE = 0.4

/** Content types we can strip. Anything else needs a human or a PDF reader. */
const READABLE_CONTENT = /^(?:text\/html|application\/xhtml\+xml|text\/plain)/i

// #endregion

// #region date comparison

/**
 * The calendar day a stored deadline instant means to a North American funder.
 *
 * Deadlines arrive as "11:59 pm ET on 15 January", which is 04:59Z on the
 * 16th. Comparing UTC dates would read the page's "15 January" as a move to a
 * different day and file a change every single pass. US offsets run -4 to -8,
 * so any instant whose UTC time of day is before noon belongs to the previous
 * US calendar day, and anything from noon on belongs to the same one.
 *
 * Exact UTC midnight is special-cased as "date only, no time was ever stated",
 * because that is how this file stores a deadline it read without a clock time
 * (see toDeadlineDate). Without the special case those round-trip a day early.
 *
 * This assumption is wrong for a European funder. There are none in the seed
 * set; when there is one it needs a per-grant timezone, not a cleverer guess
 * here.
 */
function usCalendarDate(instant: Date): string {
  const utcMinutes = instant.getUTCHours() * 60 + instant.getUTCMinutes()
  const shifted = new Date(instant.getTime())
  if (utcMinutes !== 0 && utcMinutes < 12 * 60) {
    shifted.setUTCDate(shifted.getUTCDate() - 1)
  }
  return shifted.toISOString().slice(0, 10)
}

/** True when the extractor gave a bare date with no clock time. */
function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

/**
 * Turn an extracted deadline into the instant to store.
 *
 * A date with no stated time becomes UTC midnight, which usCalendarDate reads
 * back as that same calendar day. Inventing 11:59 pm in some assumed zone
 * would render as a precise cut-off the funder never published, and the whole
 * vertical is built on not doing that. A human adds the real time when they
 * verify the cycle.
 */
function toDeadlineDate(value: string): Date | null {
  const parsed = isDateOnly(value) ? new Date(`${value.trim()}T00:00:00Z`) : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Has the deadline actually moved?
 *
 * Compared at the precision the page offered. A page that says only
 * "15 January 2027" cannot contradict a stored 11:59 pm ET on that day, so a
 * date-only read is compared day to day. A page that states a time is compared
 * to the instant, because 5 pm and 11:59 pm on the same day is a real change a
 * team needs to see.
 */
function deadlineDiffers(current: Date | null, extracted: string): boolean {
  const next = toDeadlineDate(extracted)
  if (!next) return false
  if (!current) return true
  if (isDateOnly(extracted)) return usCalendarDate(current) !== extracted.trim()
  return current.getTime() !== next.getTime()
}

/** grant_cycles.opens_at is a DATE column, so drizzle hands back 'YYYY-MM-DD'. */
function opensDiffers(current: string | null, extracted: string): boolean {
  return (current ?? '') !== extracted.trim().slice(0, 10)
}

// #endregion

// #region change filing

interface PendingChange {
  field: string
  oldValue: unknown
  newValue: unknown
  reasoning: string
  autoApplicable?: boolean
  /** Set when this row records something this job already wrote. */
  alreadyApplied?: boolean
}

/**
 * Tell everyone watching this grant that its page moved.
 *
 * One alert per pass, not one per change row: a funder who rewrites a page
 * usually trips several diffs at once and nobody wants four emails about one
 * edit. The dedupe key names the first inserted change id, which is stable for
 * this pass and unique across passes, so a retry that re-files nothing sends
 * nothing.
 *
 * awaitingReview is the honest part. Everything here is scraped and unverified
 * until a moderator confirms it, and the email says so, because a watcher
 * acting on an unconfirmed deadline is exactly the failure this vertical is
 * built to avoid.
 *
 * Failures are logged onto the pass notes rather than thrown. The monitor's
 * job is the snapshot and the change rows; losing an email must not cost the
 * content hash, which is what a throw here would do.
 */
async function notifyWatchersOfChange(
  grant: Grant,
  changes: PendingChange[],
  changeIds: string[],
  notes: string[],
): Promise<void> {
  const anchorId = changeIds[0]
  if (!anchorId) return

  const db = getDb()

  try {
    const watchers = await db
      .select({ userId: grantWatches.userId })
      .from(grantWatches)
      .where(and(eq(grantWatches.grantId, grant.id), eq(grantWatches.notifyOnChange, true)))

    if (watchers.length === 0) return

    // The reasoning strings are already written as sentences a person can read,
    // so the field name is only there to say which part of the listing moved.
    const phrases = changes.map((c) => `${c.field}: ${c.reasoning}`.slice(0, 300))
    const awaitingReview = changes.some((c) => !c.alreadyApplied)

    let queued = 0
    for (const { userId } of watchers) {
      const id = await enqueueGrantAlert({
        userId,
        kind: 'grant_change',
        grantId: grant.id,
        dedupeKey: `grant_change:${anchorId}:${userId}`,
        payload: {
          grantName: grant.name,
          grantUrl: grantUrl(grant.slug),
          changes: phrases,
          awaitingReview,
        },
      })
      if (id) queued += 1
    }

    if (queued > 0) console.log(`[grant-monitor] ${grant.slug}: queued ${queued} change alert(s)`)
  } catch (err) {
    notes.push(`change alerts could not be queued: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * The year a diff belongs to. The extractor's own cycleYear wins; failing
 * that, the year of the deadline it read; failing that the current year, which
 * is the only defensible fallback for a page with amounts but no dates.
 */
function resolveCycleYear(fields: ExtractedGrantFields, now: Date): number {
  if (typeof fields.cycleYear === 'number') return fields.cycleYear
  if (typeof fields.deadlineAt === 'string') {
    const parsed = toDeadlineDate(fields.deadlineAt)
    // Use the US calendar day, so a 04:59Z deadline on 1 January does not get
    // filed against the wrong year.
    if (parsed) return parseInt(usCalendarDate(parsed).slice(0, 4), 10)
  }
  return now.getUTCFullYear()
}

/**
 * Money and URL diffs against the grant row itself.
 *
 * Only a stated value files a change. The extractor's prompt tells the model
 * to return null for anything the page does not mention, so null cannot be
 * told apart from "the funder removed the award range", and treating it as a
 * removal would fill the review queue with deletions off a reworded paragraph.
 * A genuine removal still surfaces: the reviewer reads the snapshot text.
 *
 * `previousEligibility` is the eligibility text the LAST snapshot read.
 * Eligibility has no column on `grants` (it lives as structured
 * grant_requirements rows a human writes), so there is nothing to diff it
 * against except the previous read. Filing it matters anyway: a funder
 * quietly adding "US 501(c)(3) only" changes who can apply as much as a date
 * change does, and the reviewer turns the prose into requirements by hand.
 */
function diffGrantFields(
  grant: Grant,
  fields: ExtractedGrantFields,
  reasoning: string,
  previousEligibility: string | null,
): PendingChange[] {
  const out: PendingChange[] = []

  if (typeof fields.awardMin === 'number' && fields.awardMin !== grant.awardMin) {
    out.push({ field: 'awardMin', oldValue: grant.awardMin, newValue: fields.awardMin, reasoning })
  }
  if (typeof fields.awardMax === 'number' && fields.awardMax !== grant.awardMax) {
    out.push({ field: 'awardMax', oldValue: grant.awardMax, newValue: fields.awardMax, reasoning })
  }
  if (typeof fields.awardNotes === 'string' && fields.awardNotes.trim() && fields.awardNotes !== grant.awardNotes) {
    out.push({ field: 'awardNotes', oldValue: grant.awardNotes, newValue: fields.awardNotes, reasoning })
  }
  if (
    typeof fields.applicationUrl === 'string' &&
    fields.applicationUrl.trim() &&
    fields.applicationUrl !== grant.applicationUrl
  ) {
    out.push({
      field: 'applicationUrl',
      oldValue: grant.applicationUrl,
      newValue: fields.applicationUrl,
      reasoning,
    })
  }

  // Only file when a previous read exists to compare against. The first read
  // of a page would otherwise file the whole eligibility paragraph as a
  // "change" on every grant the day the monitor is switched on.
  if (
    typeof fields.eligibilityText === 'string' &&
    fields.eligibilityText.trim() &&
    previousEligibility !== null &&
    fields.eligibilityText.trim() !== previousEligibility.trim()
  ) {
    out.push({
      field: 'eligibilityText',
      oldValue: previousEligibility,
      newValue: fields.eligibilityText,
      reasoning: `${reasoning} (eligibility wording differs from the previous read; check grant_requirements)`,
    })
  }

  return out
}

/**
 * Cycle diffs against an EXISTING row. Nothing here writes to that row.
 *
 * The field paths are dotted by year (`cycle.2027.deadlineAt`) because that is
 * what the admin needs to apply the change to the right cycle, and because two
 * years can move in the same pass on a page that lists both.
 */
function diffCycleFields(
  cycle: GrantCycle,
  fields: ExtractedGrantFields,
  reasoning: string,
  now: Date,
): PendingChange[] {
  const out: PendingChange[] = []
  const prefix = `cycle.${cycle.cycleYear}`

  if (typeof fields.deadlineAt === 'string' && deadlineDiffers(cycle.deadlineAt, fields.deadlineAt)) {
    out.push({
      field: `${prefix}.deadlineAt`,
      oldValue: cycle.deadlineAt?.toISOString() ?? null,
      newValue: fields.deadlineAt,
      reasoning,
    })
  }

  if (typeof fields.opensAt === 'string' && opensDiffers(cycle.opensAt, fields.opensAt)) {
    out.push({
      field: `${prefix}.opensAt`,
      oldValue: cycle.opensAt,
      newValue: fields.opensAt.slice(0, 10),
      reasoning,
    })
  }

  if (
    typeof fields.deadlineNote === 'string' &&
    fields.deadlineNote.trim() &&
    fields.deadlineNote !== cycle.deadlineNote
  ) {
    out.push({
      field: `${prefix}.deadlineNote`,
      oldValue: cycle.deadlineNote,
      newValue: fields.deadlineNote,
      reasoning,
    })
  }

  // A page that says it is shut is the one status signal worth filing. The
  // other direction is not symmetrical: a page that stops saying "closed" is
  // usually a rewrite, not a reopening, so it waits for a date to move.
  if (fields.looksClosed === true && cycle.status !== 'closed') {
    out.push({
      field: `${prefix}.status`,
      oldValue: cycle.status,
      newValue: 'closed',
      reasoning: `${reasoning} (page states the round is closed)`,
    })
  } else if (
    fields.looksClosed !== true &&
    typeof fields.deadlineAt === 'string' &&
    cycle.status !== 'closed'
  ) {
    // Only re-derive when the page gave us a date to derive from, and never
    // over the top of a closed cycle: a closed cycle is history.
    const next = toDeadlineDate(fields.deadlineAt)
    const derived = deriveCycleStatus(cycle.opensAt, next, now)
    if (derived !== cycle.status && derived !== 'unknown') {
      out.push({
        field: `${prefix}.status`,
        oldValue: cycle.status,
        newValue: derived,
        reasoning: `${reasoning} (status derived from the dates on the page)`,
      })
    }
  }

  return out
}

// #endregion

/** Fetch outcome, kept separate so every failure path writes the same snapshot. */
interface FetchOutcome {
  html: string | null
  httpStatus: number | null
  error: string | null
  /** Final URL after redirects, when it differs from the one we asked for. */
  redirectedTo: string | null
}

async function fetchPage(url: string): Promise<FetchOutcome> {
  try {
    const res = await politeFetch(url)
    const redirectedTo = res.url && res.url !== url ? res.url : null

    if (!res.ok) {
      return { html: null, httpStatus: res.status, error: `HTTP ${res.status} ${res.statusText}`.trim(), redirectedTo }
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (contentType && !READABLE_CONTENT.test(contentType)) {
      // A funder that moves its guidelines into a PDF is a real thing that
      // happens, and it needs a person, not a retry. Counting it as a failure
      // is what eventually surfaces it as a dead page in the admin.
      return {
        html: null,
        httpStatus: res.status,
        error: `unreadable content-type "${contentType}", needs a human`,
        redirectedTo,
      }
    }

    return { html: await res.text(), httpStatus: res.status, error: null, redirectedTo }
  } catch (err) {
    // politeFetch aborts at 15s. A timeout and a DNS failure are the same
    // thing here: no content, so no diff, so nothing is overwritten.
    return {
      html: null,
      httpStatus: null,
      error: err instanceof Error ? err.message : String(err),
      redirectedTo: null,
    }
  }
}

/**
 * Monitor one grant.
 *
 * Returns rather than throwing for anything the page did (a 404, a timeout, a
 * PDF): those are recorded state, not job failures, and a BullMQ retry would
 * just fetch the same broken page three more times. Only a database or
 * programming fault escapes.
 */
export async function processGrantMonitorJob(payload: GrantMonitorPayload): Promise<GrantMonitorOutcome> {
  const db = getDb()
  const { grantId } = payload
  const now = new Date()
  const notes: string[] = []

  const [grant] = await db.select().from(grants).where(eq(grants.id, grantId)).limit(1)

  if (!grant) {
    console.warn(`[grant-monitor] grant ${grantId} no longer exists, nothing to check`)
    return {
      grantId,
      snapshotId: null,
      changed: false,
      httpStatus: null,
      changesFiled: 0,
      extraction: 'skipped',
      notes: ['grant row not found'],
      error: 'grant not found',
    }
  }

  const fetched = await fetchPage(grant.infoUrl)
  if (fetched.redirectedTo) {
    // Worth seeing but not worth failing on. A permanent move shows up as the
    // same redirect on every pass, and a reviewer can repoint infoUrl.
    notes.push(`redirected to ${fetched.redirectedTo}`)
  }

  const text = fetched.html ? stripToMainContent(fetched.html) : ''

  // An empty strip on a 200 is treated as a failed read, not as an empty page.
  // Hashing "" would clear the stored hash and make the next real fetch look
  // like a change, which is the one thing this job exists to get right.
  const readError =
    fetched.error ?? (fetched.html !== null && text.trim() === '' ? 'page stripped to no content (bot wall or JS-only render)' : null)

  // #region failure path

  if (readError) {
    const [snapshot] = await db
      .insert(grantSnapshots)
      .values({
        grantId: grant.id,
        url: grant.infoUrl,
        httpStatus: fetched.httpStatus,
        changed: false,
        error: readError.slice(0, 500),
      })
      .returning({ id: grantSnapshots.id })

    // lastCheckedAt moves even on a failure: the cadence is "how long since we
    // tried", otherwise a dead page is retried on every single tick forever.
    // contentHash is left alone so the next good fetch still diffs correctly.
    await db
      .update(grants)
      .set({
        lastCheckedAt: now,
        checkFailureCount: grant.checkFailureCount + 1,
        updatedAt: now,
      })
      .where(eq(grants.id, grant.id))

    console.warn(
      `[grant-monitor] ${grant.slug}: fetch failed (${readError}); ` +
        `consecutive failures ${grant.checkFailureCount + 1}. No changes filed.`,
    )

    return {
      grantId,
      snapshotId: snapshot?.id ?? null,
      changed: false,
      httpStatus: fetched.httpStatus,
      changesFiled: 0,
      extraction: 'skipped',
      notes,
      error: readError,
    }
  }

  // #endregion

  const contentHash = hashContent(text)
  const changed = contentHash !== grant.contentHash

  const [snapshot] = await db
    .insert(grantSnapshots)
    .values({
      grantId: grant.id,
      url: grant.infoUrl,
      httpStatus: fetched.httpStatus,
      contentHash,
      contentText: text.slice(0, SNAPSHOT_TEXT_LIMIT),
      changed,
    })
    .returning({ id: grantSnapshots.id })

  const snapshotId = snapshot?.id ?? null

  // #region unchanged path (the common one, and the cheap one)

  if (!changed) {
    await db
      .update(grants)
      .set({ lastCheckedAt: now, checkFailureCount: 0, updatedAt: now })
      .where(eq(grants.id, grant.id))

    console.log(`[grant-monitor] ${grant.slug}: unchanged (${contentHash.slice(0, 12)}), no extraction`)

    return {
      grantId,
      snapshotId,
      changed: false,
      httpStatus: fetched.httpStatus,
      changesFiled: 0,
      extraction: 'skipped',
      notes,
      error: null,
    }
  }

  // #endregion

  // #region changed path

  const cycles = await db.select().from(grantCycles).where(eq(grantCycles.grantId, grant.id))

  // The read before this one, excluding the row we just wrote. Used for the
  // fields that have no home on `grants` and can only be diffed read to read.
  const [previousSnapshot] = snapshotId
    ? await db
        .select({ extracted: grantSnapshots.extracted })
        .from(grantSnapshots)
        .where(and(eq(grantSnapshots.grantId, grant.id), ne(grantSnapshots.id, snapshotId)))
        .orderBy(desc(grantSnapshots.fetchedAt))
        .limit(1)
    : []
  const previousEligibility = previousSnapshot?.extracted?.eligibilityText ?? null

  // Sorted newest first so the "current" context handed to the extractor is
  // the year a team is actually working towards.
  const sortedCycles = [...cycles].sort((a, b) => b.cycleYear - a.cycleYear)
  const currentCycle = sortedCycles[0]

  let extraction: GrantExtractionResult
  try {
    extraction = await extractGrantFields(text, {
      url: grant.infoUrl,
      grantName: grant.name,
      deadlineType: grant.deadlineType,
      currentDeadlineIso: currentCycle?.deadlineAt?.toISOString() ?? null,
      currentAwardMin: grant.awardMin,
      currentAwardMax: grant.awardMax,
    })
  } catch (err) {
    // extractGrantFields handles credit exhaustion and API errors itself, so
    // reaching here means something unexpected. Record it and keep the grant's
    // data as it was rather than losing the pass entirely.
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[grant-monitor] ${grant.slug}: extractor threw: ${message}`)
    await db
      .update(grants)
      .set({ lastCheckedAt: now, checkFailureCount: 0, updatedAt: now })
      .where(eq(grants.id, grant.id))
    return {
      grantId,
      snapshotId,
      changed: true,
      httpStatus: fetched.httpStatus,
      changesFiled: 0,
      extraction: 'none',
      notes: [...notes, `extractor threw: ${message}`],
      error: message,
    }
  }

  notes.push(...extraction.notes)

  if (snapshotId) {
    await db.update(grantSnapshots).set({ extracted: extraction.fields }).where(eq(grantSnapshots.id, snapshotId))
  }

  const fields = extraction.fields
  const reasoning = `${extraction.source} extraction (confidence ${extraction.confidence.toFixed(2)}): ${extraction.reasoning}`

  // Low confidence still gets its snapshot and its hash, it just does not get
  // to propose an edit. Logged, because "we looked and said nothing" and "we
  // never looked" must not read the same in the admin.
  const trustworthy = extraction.source !== 'none' && extraction.confidence >= MIN_DIFF_CONFIDENCE
  if (!trustworthy) {
    notes.push(
      `content changed but extraction was not usable (source ${extraction.source}, confidence ${extraction.confidence.toFixed(2)}), no changes filed`,
    )
  }

  const proposed: PendingChange[] = []

  if (trustworthy) {
    proposed.push(...diffGrantFields(grant, fields, reasoning, previousEligibility))

    const cycleYear = resolveCycleYear(fields, now)
    const existing = cycles.find((c) => c.cycleYear === cycleYear)

    if (existing) {
      proposed.push(...diffCycleFields(existing, fields, reasoning, now))
    } else if (typeof fields.deadlineAt === 'string' || typeof fields.opensAt === 'string') {
      // A year we hold no cycle row for at all. This used to insert the cycle
      // outright on the grounds that adding a year cannot contradict anything
      // a human verified. That reasoning was wrong in its consequences: the
      // row landed with isEstimated false, the public page rendered a live
      // countdown on it, and ./deadline-sweeper.ts screens only on
      // isEstimated, so teams were emailed "X days left to apply" against a
      // date nobody had read. A wrong deadline is worse than no deadline, so
      // a new year is now proposed exactly like every other date: as pending
      // rows a person applies.
      //
      // These are filed per column (cycle.<year>.deadlineAt and friends)
      // rather than as one cycle.<year> row, because resolveChangeField in
      // apps/web/lib/admin/grants.ts only resolves a three-part cycle path.
      // A bare cycle.<year> row cannot be applied from the admin screen at
      // all; it sits in the queue and the reviewer gets told to go fix the
      // extractor. The insert branch in changes/actions.ts creates the cycle
      // on first apply, so the first column applied makes the row.
      const deadlineAt = typeof fields.deadlineAt === 'string' ? toDeadlineDate(fields.deadlineAt) : null
      const opensAt = typeof fields.opensAt === 'string' ? fields.opensAt.trim().slice(0, 10) : null
      const isFutureYear = cycleYear >= now.getUTCFullYear()
      const prefix = `cycle.${cycleYear}`

      // Backfilling a past year is a judgement call, and it is never urgent,
      // so it says so in the reasoning rather than being filed as if the
      // funder had just posted next year's round.
      const why = isFutureYear
        ? `${reasoning} (no ${cycleYear} cycle on file yet)`
        : `${reasoning} (dates read for ${cycleYear}, a past year, so this is a backfill)`

      if (deadlineAt) {
        proposed.push({
          field: `${prefix}.deadlineAt`,
          oldValue: null,
          newValue: deadlineAt.toISOString(),
          reasoning: why,
          autoApplicable: isFutureYear,
        })
      }

      if (opensAt) {
        proposed.push({
          field: `${prefix}.opensAt`,
          oldValue: null,
          newValue: opensAt,
          reasoning: why,
          autoApplicable: isFutureYear,
        })
      }

      if (typeof fields.deadlineNote === 'string' && fields.deadlineNote.trim()) {
        proposed.push({
          field: `${prefix}.deadlineNote`,
          oldValue: null,
          newValue: fields.deadlineNote.trim(),
          reasoning: why,
          autoApplicable: isFutureYear,
        })
      }
    }
  }

  // Do not re-file something already sitting in the queue. A page that
  // flip-flops between two wordings would otherwise hand a reviewer the same
  // row over and over.
  const alreadyPending = await db
    .select({ field: grantChanges.field, newValue: grantChanges.newValue })
    .from(grantChanges)
    .where(and(eq(grantChanges.grantId, grant.id), eq(grantChanges.status, 'pending')))

  const pendingKeys = new Set(alreadyPending.map((c) => `${c.field} ${JSON.stringify(c.newValue ?? null)}`))

  const toInsert = proposed.filter(
    (c) => !pendingKeys.has(`${c.field} ${JSON.stringify(c.newValue ?? null)}`),
  )
  const duplicates = proposed.length - toInsert.length
  if (duplicates > 0) notes.push(`${duplicates} change(s) already pending review, not re-filed`)

  let insertedChangeIds: string[] = []
  if (toInsert.length > 0) {
    const inserted = await db
      .insert(grantChanges)
      .values(
        toInsert.map((c) => ({
          grantId: grant.id,
          snapshotId,
          field: c.field,
          oldValue: c.oldValue ?? null,
          newValue: c.newValue ?? null,
          reasoning: c.reasoning.slice(0, 1000),
          autoApplicable: c.autoApplicable ?? false,
          // An already-applied row is an audit record, not a task. Marking it
          // 'applied' keeps it out of the reviewer's action queue while leaving
          // the trail intact, and the cycle it created still carries a null
          // verifiedAt so nothing is presented as human-confirmed.
          status: c.alreadyApplied ? 'applied' : 'pending',
          reviewedBy: c.alreadyApplied ? 'system:grant-monitor' : null,
          reviewedAt: c.alreadyApplied ? now : null,
        })),
      )
      .returning({ id: grantChanges.id })
    insertedChangeIds = inserted.map((r) => r.id)

    await notifyWatchersOfChange(grant, toInsert, insertedChangeIds, notes)
  }

  // Advance the hash only when the extraction was real. A degraded pass (no
  // API key, credit exhausted, extractor error) must NOT bank the new hash:
  // doing so would mark this content as read and mean the change is never
  // looked at again once credit comes back.
  const bankHash = !extraction.degraded
  if (!bankHash) {
    notes.push('extraction degraded, content hash not advanced so the next pass re-reads this page')
  }

  await db
    .update(grants)
    .set({
      lastCheckedAt: now,
      checkFailureCount: 0,
      ...(bankHash ? { contentHash } : {}),
      updatedAt: now,
    })
    .where(eq(grants.id, grant.id))

  for (const note of notes) console.warn(`[grant-monitor] ${grant.slug}: ${note}`)
  console.log(
    `[grant-monitor] ${grant.slug}: content changed, extraction=${extraction.source} ` +
      `confidence=${extraction.confidence.toFixed(2)} changes=${toInsert.length}`,
  )

  return {
    grantId,
    snapshotId,
    changed: true,
    httpStatus: fetched.httpStatus,
    changesFiled: toInsert.length,
    extraction: extraction.source,
    notes,
    error: null,
  }

  // #endregion
}

/**
 * Most recent snapshot for a grant, for the admin change-review screen. Kept
 * here because the "previous stripped text" is only meaningful next to the
 * rules above that produced it.
 */
export async function getLatestGrantSnapshot(grantId: string) {
  const db = getDb()
  const [row] = await db
    .select()
    .from(grantSnapshots)
    .where(eq(grantSnapshots.grantId, grantId))
    .orderBy(desc(grantSnapshots.fetchedAt))
    .limit(1)
  return row ?? null
}
