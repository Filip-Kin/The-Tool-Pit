/**
 * Off-season event and practice-field DISCOVER job: run one connector, dedupe
 * what it found, file the rest as candidates for a human.
 *
 * THE HARD RULE OF BOTH VERTICALS LIVES IN THIS FILE. Nothing here writes to
 * `event_listings` or to `practice_fields`. Not a new row, not a date, not a
 * "we are sure enough" shortcut. Discovery produces candidates with status
 * 'pending' and a person decides.
 *
 * That is not caution for its own sake. The tools vertical auto-published its
 * crawl output, filled up with forum threads and bot walls, and Filip is still
 * cleaning it out. An events directory that does the same publishes a date
 * that is wrong and a team drives to a closed building; a fields directory
 * that does the same sends a team to a gym that never agreed to host them.
 *
 * One job and one queue serve both verticals because they are the same job:
 * the connector's `vertical` says which candidate table its output belongs in.
 */
import { eq, inArray } from 'drizzle-orm'
import {
  getDb,
  eventListingCandidates,
  eventListingCrawlJobs,
  eventListingCrawlSources,
  eventListings,
  practiceFieldCandidates,
  practiceFieldCrawlJobs,
  practiceFieldCrawlSources,
  type EventListingCrawlStats,
  type PracticeFieldCrawlStats,
} from '@the-tool-pit/db'
import { TbaOffseasonEventsConnector } from './connectors/tba-offseason.js'
import { ChiefDelphiEventsConnector } from './connectors/chief-delphi-events.js'
import { ChiefDelphiFieldsConnector } from './connectors/chief-delphi-fields.js'
import { canonicalListingUrl } from './connectors/shared.js'
import type {
  EventListingCandidateInput,
  ListingConnector,
  PracticeFieldCandidateInput,
} from './types.js'

/**
 * Payload for the listing-discover queue. Kept beside the processor rather
 * than in @the-tool-pit/types, the same call the grants vertical made, so this
 * lands without touching the shared package.
 */
export interface ListingDiscoverPayload {
  /** A key of LISTING_DISCOVER_CONNECTORS. */
  connector: string
  /** Set when one crawl source row was requeued by hand from the admin. */
  sourceId?: string
}

/**
 * Connector registry.
 *
 * Keyed by connector name only, unlike the grants registry which also accepts
 * the bare source `kind`. Kind is ambiguous here: 'chief_delphi' is a source
 * kind in BOTH verticals, and resolving it to one of them by guessing is
 * exactly the sort of silent wrong turn this vertical cannot afford.
 */
export const LISTING_DISCOVER_CONNECTORS: Record<string, () => ListingConnector> = {
  tba_offseason_events: () => new TbaOffseasonEventsConnector(),
  cd_offseason_events: () => new ChiefDelphiEventsConnector(),
  cd_practice_fields: () => new ChiefDelphiFieldsConnector(),
}

export interface ListingDiscoverOutcome {
  jobId: string
  connector: string
  vertical: 'event' | 'field'
  insertedCandidateIds: string[]
  stats: EventListingCrawlStats | PracticeFieldCrawlStats
}

interface ResolvedSource {
  id: string
  config: Record<string, unknown> | null
  /** Set when the source says this run should not happen. */
  skipReason?: string
}

/**
 * Find the crawl source row governing this connector, and decide whether the
 * run is allowed.
 *
 * A source row is OPTIONAL. No row means the connector runs with its built-in
 * settings, which is how all three ship. A row is what an admin creates to
 * turn a noisy source off or slow it down, and `enabled` is the off switch.
 *
 * An explicit sourceId means a human pressed "run now" in the admin, so the
 * cadence check is skipped. Telling somebody who just clicked the button that
 * the source is not due yet is the kind of thing that gets a crawler declared
 * broken.
 */
async function resolveSource(
  connector: ListingConnector,
  sourceId?: string,
): Promise<ResolvedSource | null> {
  const db = getDb()
  const table = connector.vertical === 'event' ? eventListingCrawlSources : practiceFieldCrawlSources

  const rows = sourceId
    ? await db.select().from(table).where(eq(table.id, sourceId)).limit(1)
    : await db.select().from(table).where(eq(table.kind, connector.sourceKind)).limit(1)

  const row = rows[0]
  if (!row) return null

  if (!row.enabled) {
    return { id: row.id, config: row.config ?? null, skipReason: `source "${row.label}" is disabled` }
  }

  if (!sourceId && row.lastRunAt) {
    const dueAt = row.lastRunAt.getTime() + row.cadenceHours * 3_600_000
    if (Date.now() < dueAt) {
      return {
        id: row.id,
        config: row.config ?? null,
        skipReason: `source "${row.label}" is on a ${row.cadenceHours}h cadence and is next due ${new Date(dueAt).toISOString()}`,
      }
    }
  }

  return { id: row.id, config: row.config ?? null }
}

/** Canonical URLs already spoken for, so the same page is not queued twice. */
async function knownCandidateUrls(
  vertical: 'event' | 'field',
  runUrls: string[],
): Promise<Set<string>> {
  const db = getDb()
  const known = new Set<string>()
  if (runUrls.length === 0) return known

  const table = vertical === 'event' ? eventListingCandidates : practiceFieldCandidates
  // Chunked because Postgres parameter limits bite well before a crawl does.
  for (let i = 0; i < runUrls.length; i += 500) {
    const chunk = runUrls.slice(i, i + 500)
    const rows = await db
      .select({ canonicalUrl: table.canonicalUrl })
      .from(table)
      .where(inArray(table.canonicalUrl, chunk))
    for (const row of rows) if (row.canonicalUrl) known.add(row.canonicalUrl)
  }
  return known
}

/**
 * TBA keys that are already an event listing or already a candidate.
 *
 * This is the check that stops the daily TBA sweep re-filing every off-season
 * event in the state every morning. event_listings.tba_key is indexed and so
 * is the candidate column, so it is two cheap lookups.
 */
async function knownTbaKeys(runKeys: string[]): Promise<Set<string>> {
  const db = getDb()
  const known = new Set<string>()
  if (runKeys.length === 0) return known

  for (let i = 0; i < runKeys.length; i += 500) {
    const chunk = runKeys.slice(i, i + 500)

    const listed = await db
      .select({ tbaKey: eventListings.tbaKey })
      .from(eventListings)
      .where(inArray(eventListings.tbaKey, chunk))
    for (const row of listed) if (row.tbaKey) known.add(row.tbaKey)

    const queued = await db
      .select({ tbaKey: eventListingCandidates.tbaKey })
      .from(eventListingCandidates)
      .where(inArray(eventListingCandidates.tbaKey, chunk))
    for (const row of queued) if (row.tbaKey) known.add(row.tbaKey)
  }
  return known
}

/**
 * Run one discovery connector end to end. Returns the outcome; it enqueues
 * nothing, because queue wiring lives in ../queues.ts and because there is
 * nothing downstream to enqueue: every connector here is deterministic, so
 * there is no classification pass and no Anthropic spend on this path at all.
 */
export async function processListingDiscoverJob(
  payload: ListingDiscoverPayload,
): Promise<ListingDiscoverOutcome> {
  const db = getDb()
  const { connector: connectorName, sourceId } = payload

  const factory = LISTING_DISCOVER_CONNECTORS[connectorName]
  if (!factory) {
    // Thrown before any job row is written: an unknown connector is a wiring
    // mistake, not a crawl that failed, and a failed row would read as though
    // the source were broken.
    throw new Error(`Unknown listing discover connector: ${connectorName}`)
  }

  const connector = factory()
  const isEvent = connector.vertical === 'event'
  const jobTable = isEvent ? eventListingCrawlJobs : practiceFieldCrawlJobs
  const sourceTable = isEvent ? eventListingCrawlSources : practiceFieldCrawlSources

  const source = await resolveSource(connector, sourceId)

  const [jobRecord] = await db
    .insert(jobTable)
    .values({
      sourceId: source?.id ?? null,
      connector: connector.name,
      status: 'running',
      startedAt: new Date(),
    })
    .returning({ id: jobTable.id })
  const jobId = jobRecord.id

  const emptyStats = {
    connector: connector.name,
    discovered: 0,
    new: 0,
    // Discovery never updates anything. Changing a published listing is a
    // separate, reviewed action.
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
    limits: [] as string[],
  }

  // A source an admin switched off, or one that is not due. Recorded as a
  // finished job with the reason on it rather than as silence, so "why did
  // nothing happen last night" has an answer in the admin.
  if (source?.skipReason) {
    const stats = { ...emptyStats, limits: [source.skipReason] }
    await db
      .update(jobTable)
      .set({ status: 'done', finishedAt: new Date(), stats, error: null })
      .where(eq(jobTable.id, jobId))
    console.log(`[listing-discover] ${connector.name} skipped: ${source.skipReason}`)
    return { jobId, connector: connector.name, vertical: connector.vertical, insertedCandidateIds: [], stats }
  }

  const insertedCandidateIds: string[] = []

  try {
    const result = await connector.run({ sourceId, config: source?.config ?? undefined })

    // #region dedupe within the run
    // Two queries regularly land on the same thread, and that is a good sign,
    // not a second review chore.
    const byUrl = new Map<string, (typeof result.candidates)[number]>()
    let duplicateInRun = 0
    for (const candidate of result.candidates) {
      const canonical = canonicalListingUrl(candidate.canonicalUrl) ?? candidate.canonicalUrl
      if (byUrl.has(canonical)) {
        duplicateInRun++
        continue
      }
      byUrl.set(canonical, { ...candidate, canonicalUrl: canonical })
    }
    // #endregion

    const knownUrls = await knownCandidateUrls(connector.vertical, [...byUrl.keys()])
    const knownKeys = isEvent
      ? await knownTbaKeys(
          [...byUrl.values()]
            .map((c) => ('tbaKey' in c ? c.tbaKey : undefined))
            .filter((k): k is string => typeof k === 'string'),
        )
      : new Set<string>()

    let inserted = 0
    let alreadyKnown = duplicateInRun
    let failed = 0

    for (const [canonical, candidate] of byUrl) {
      if (knownUrls.has(canonical)) {
        alreadyKnown++
        continue
      }
      const tbaKey = 'tbaKey' in candidate ? candidate.tbaKey : undefined
      if (tbaKey && knownKeys.has(tbaKey)) {
        alreadyKnown++
        continue
      }

      try {
        if (isEvent) {
          const c = candidate as EventListingCandidateInput
          const [stored] = await db
            .insert(eventListingCandidates)
            .values({
              jobId,
              sourceId: c.sourceId ?? source?.id ?? null,
              sourceUrl: c.sourceUrl,
              canonicalUrl: canonical,
              tbaKey: c.tbaKey ?? null,
              rawMetadata: {
                title: c.title,
                description: c.description,
                discoveredVia: c.discoveredVia,
                evidence: c.evidence,
                links: c.links,
                tbaEventType: c.tbaEventType,
              },
              extracted: c.extracted,
              // Always pending. Discovery has no opinion it is entitled to act on.
              status: 'pending',
            })
            .returning({ id: eventListingCandidates.id })
          insertedCandidateIds.push(stored.id)
        } else {
          const c = candidate as PracticeFieldCandidateInput
          const [stored] = await db
            .insert(practiceFieldCandidates)
            .values({
              jobId,
              sourceId: c.sourceId ?? source?.id ?? null,
              sourceUrl: c.sourceUrl,
              canonicalUrl: canonical,
              teamNumber: c.teamNumber ?? null,
              rawMetadata: {
                title: c.title,
                description: c.description,
                discoveredVia: c.discoveredVia,
                signals: c.signals,
                evidence: c.evidence,
                links: c.links,
              },
              extracted: c.extracted,
              status: 'pending',
            })
            .returning({ id: practiceFieldCandidates.id })
          insertedCandidateIds.push(stored.id)
        }

        // Guards against one connector emitting the same page under two raw
        // URLs that canonicalise identically mid-loop.
        knownUrls.add(canonical)
        if (tbaKey) knownKeys.add(tbaKey)
        inserted++
      } catch (err) {
        failed++
        result.errors.push(`[listing-discover] insert failed for ${canonical}: ${String(err)}`)
      }
    }

    const stats = {
      ...emptyStats,
      discovered: result.candidates.length,
      new: inserted,
      unchanged: alreadyKnown,
      skipped: result.skipped,
      failed,
      errors: result.errors,
      limits: result.limits,
    }

    await db
      .update(jobTable)
      .set({
        status: 'done',
        finishedAt: new Date(),
        stats,
        // The job is 'done', so this is a summary a human can read at a glance,
        // not a failure. Nothing is hidden by success.
        error: result.errors.length > 0 ? result.errors.slice(0, 20).join('\n') : null,
      })
      .where(eq(jobTable.id, jobId))

    // Stamp the source rows this run touched. lastRunAt is what the cadence
    // check reads, so forgetting it makes a cadence meaningless.
    const touched = [...new Set([...(result.touchedSourceIds ?? []), ...(source ? [source.id] : [])])]
    if (touched.length > 0) {
      await db
        .update(sourceTable)
        .set({ lastRunAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(inArray(sourceTable.id, touched))
    }

    for (const limit of result.limits) {
      console.warn(`[listing-discover] ${connector.name} coverage limit: ${limit}`)
    }
    console.log(
      `[listing-discover] ${connector.name} done: ${inserted} new, ${alreadyKnown} already known, ${result.skipped} skipped, ${failed} failed, ${result.errors.length} errors, ${result.limits.length} coverage limits`,
    )

    return { jobId, connector: connector.name, vertical: connector.vertical, insertedCandidateIds, stats }
  } catch (err) {
    await db
      .update(jobTable)
      .set({ status: 'failed', finishedAt: new Date(), error: String(err) })
      .where(eq(jobTable.id, jobId))
    if (source) {
      await db
        .update(sourceTable)
        .set({ lastError: String(err).slice(0, 500), updatedAt: new Date() })
        .where(eq(sourceTable.id, source.id))
    }
    // Rethrow so BullMQ retries, the same contract as ../jobs/crawl.ts.
    throw err
  }
}
