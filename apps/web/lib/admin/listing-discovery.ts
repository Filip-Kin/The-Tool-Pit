/**
 * Shared server helpers for the two listing discovery queues: off-season event
 * candidates and practice-field candidates.
 *
 * The rule both verticals are built around is that a crawler never writes to
 * `event_listings` or `practice_fields`. A reviewer ACCEPTS a candidate, which
 * creates a row with `source: 'scrape'` and `status: 'pending'`, so a scraped
 * lead passes the same publish gate a public submission does. Nothing here can
 * publish, and neither accept path writes coordinates, which is what the
 * publish gate checks for.
 *
 * Both verticals need the same four things (a queue handle, a connector name,
 * counter bumps and an extracted-to-row mapping), so they live here once
 * instead of being retyped per route.
 */
import { eq, sql } from 'drizzle-orm'
import { Queue } from 'bullmq'
import { getDb } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { eventListingCrawlSources, practiceFieldCrawlSources } from '@the-tool-pit/db'

/** Which candidate queue a helper is working on. */
export type ListingVertical = 'event' | 'field'

/**
 * The extracted-to-row mapping lives in its own module because it is pure and
 * therefore testable: importing it must not drag in the DB client or bullmq.
 * Re-exported here so a route has one import to reach for.
 */
export { eventListingFromCandidate, practiceFieldFromCandidate } from './listing-candidate-mapping'

// #region queue

/**
 * SHARED WITH THE WORKER. The queue name and the payload shape are duplicated
 * from apps/worker/src/listings/discover.ts (ListingDiscoverPayload), because
 * the web app cannot import from apps/worker. Change them in both places
 * together: a drift here queues jobs nothing reads, which on this screen looks
 * exactly like a source that finds nothing.
 */
const LISTING_DISCOVER_QUEUE = 'listing-discover'

interface ListingDiscoverPayload {
  connector: string
  sourceId?: string
}

let _queue: Queue<ListingDiscoverPayload> | undefined

function getListingDiscoverQueue(): Queue<ListingDiscoverPayload> {
  if (!_queue) {
    _queue = new Queue<ListingDiscoverPayload>(LISTING_DISCOVER_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    })
  }
  return _queue
}

/**
 * Connector names the worker registry accepts, per vertical. Also duplicated
 * from discover.ts (LISTING_DISCOVER_CONNECTORS) for the reason above.
 */
export const LISTING_CONNECTORS: Record<ListingVertical, { connector: string; label: string; description: string }[]> = {
  event: [
    {
      connector: 'tba_offseason_events',
      label: 'TBA off-season events',
      description: 'Structured events somebody registered with TBA. Dates and a venue, never cost or capacity.',
    },
    {
      connector: 'cd_offseason_events',
      label: 'Chief Delphi announcements',
      description: 'Announcement threads, which run months ahead of TBA and are prose.',
    },
  ],
  field: [
    {
      connector: 'cd_practice_fields',
      label: 'Chief Delphi field threads',
      description: 'Threads that mention a practice field. Reads the team, never the field spec.',
    },
  ],
}

/**
 * The connector a source row should be run through.
 *
 * Resolved from the row's own `kind`, never from anything the browser sent, so
 * this cannot be used to run an arbitrary connector name. It returns null for
 * the `seed` and `admin` kinds, which are rows a human filed by hand and have
 * no crawler behind them.
 *
 * The kind alone is not enough: 'chief_delphi' is a source kind in BOTH
 * verticals, so the vertical decides which of the two forum connectors runs.
 */
export function connectorForSourceKind(vertical: ListingVertical, kind: string): string | null {
  if (vertical === 'event') {
    if (kind === 'tba_offseason') return 'tba_offseason_events'
    if (kind === 'chief_delphi') return 'cd_offseason_events'
    return null
  }
  if (kind === 'chief_delphi') return 'cd_practice_fields'
  return null
}

/** Queue one discovery run. `sourceId` makes the worker skip the cadence check. */
export async function queueListingDiscover(connector: string, sourceId?: string): Promise<{ error?: string }> {
  try {
    await getListingDiscoverQueue().add('listing-discover', sourceId ? { connector, sourceId } : { connector })
  } catch (err) {
    return { error: `Could not queue the job: ${String(err)}` }
  }
  return {}
}

// #endregion

// #region source counters

/**
 * Move a source's yield / reject tallies, the same way lib/admin/grants.ts
 * does for grant sources.
 *
 * These two numbers are the only way to tell a source that finds real events
 * and real fields from one that fills the queue with threads asking whether
 * anyone HAS a practice field, so every decision feeds them. Nothing else
 * writes these columns.
 */
export async function bumpListingSourceCounter(
  vertical: ListingVertical,
  sourceId: string | null | undefined,
  counter: 'yield' | 'reject',
) {
  if (!sourceId) return
  const db = getDb()
  const table = vertical === 'event' ? eventListingCrawlSources : practiceFieldCrawlSources
  const col = counter === 'yield' ? table.yieldCount : table.rejectCount
  await db
    .update(table)
    .set({ [counter === 'yield' ? 'yieldCount' : 'rejectCount']: sql`${col} + 1`, updatedAt: new Date() })
    .where(eq(table.id, sourceId))
}

// #endregion

// #region source administration

/**
 * Source-row administration for both verticals.
 *
 * A source row is OPTIONAL to the worker: with no row a connector runs on its
 * built-in settings, which is how all three shipped. The row is what an admin
 * creates to get an off switch and a cadence, so creating one is part of this
 * screen rather than a seed script.
 */

const SOURCES_PATH: Record<ListingVertical, string> = {
  event: '/admin/event-listings/sources',
  field: '/admin/practice-fields/sources',
}

function sourcesTable(vertical: ListingVertical) {
  return vertical === 'event' ? eventListingCrawlSources : practiceFieldCrawlSources
}

/**
 * Requeue one source by hand.
 *
 * The connector comes from the row's own kind, so this cannot run an arbitrary
 * connector name. A disabled source is refused rather than quietly run:
 * switching a noisy source off has to actually mean off.
 */
export async function runListingSourceRow(vertical: ListingVertical, sourceId: string): Promise<{ error?: string }> {
  const db = getDb()
  const table = sourcesTable(vertical)
  const [source] = await db
    .select({ id: table.id, kind: table.kind, enabled: table.enabled, label: table.label })
    .from(table)
    .where(eq(table.id, sourceId))
    .limit(1)
  if (!source) return { error: 'Source not found.' }
  if (!source.enabled) return { error: `"${source.label}" is switched off. Enable it first if you want it to run.` }

  const connector = connectorForSourceKind(vertical, source.kind)
  if (!connector) {
    return { error: `"${source.label}" is a ${source.kind} row, which no connector reads. It is a note, not a crawl.` }
  }

  const queued = await queueListingDiscover(connector, source.id)
  if (queued.error) return queued
  return {}
}

/** Switch a source on or off. The yield and reject columns are the case for off. */
export async function setListingSourceEnabled(
  vertical: ListingVertical,
  sourceId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const db = getDb()
  const table = sourcesTable(vertical)
  const [source] = await db.select({ id: table.id }).from(table).where(eq(table.id, sourceId)).limit(1)
  if (!source) return { error: 'Source not found.' }

  await db.update(table).set({ enabled, updatedAt: new Date() }).where(eq(table.id, sourceId))
  return {}
}

/**
 * Change how often a source runs. Hours, because that is the column's unit and
 * a "daily / weekly" dropdown would hide that the scheduler works in hours.
 */
export async function setListingSourceCadence(
  vertical: ListingVertical,
  sourceId: string,
  cadenceHours: number,
): Promise<{ error?: string }> {
  if (!Number.isFinite(cadenceHours) || cadenceHours < 1 || cadenceHours > 8760) {
    return { error: 'Cadence must be between 1 hour and a year.' }
  }
  const db = getDb()
  const table = sourcesTable(vertical)
  const [source] = await db.select({ id: table.id }).from(table).where(eq(table.id, sourceId)).limit(1)
  if (!source) return { error: 'Source not found.' }

  await db.update(table).set({ cadenceHours: Math.round(cadenceHours), updatedAt: new Date() }).where(eq(table.id, sourceId))
  return {}
}

export interface NewListingSourceInput {
  kind: string
  label: string
  target: string
  cadenceHours: number
  notes?: string
}

/**
 * Create a source row.
 *
 * The worker looks a source up by kind, so a second enabled row of the same
 * kind would be found by nothing but a hand-pressed Run now. That is refused
 * here rather than left to be discovered when a cadence change has no effect.
 */
export async function createListingSource(
  vertical: ListingVertical,
  input: NewListingSourceInput,
  allowedKinds: readonly string[],
): Promise<{ error?: string }> {
  const kind = input.kind.trim()
  if (!allowedKinds.includes(kind)) return { error: `Unknown source kind "${kind}".` }
  const label = input.label.trim()
  if (!label) return { error: 'Give the source a label.' }
  const target = input.target.trim()
  if (!target) return { error: 'Give the source a target: the page, endpoint or query it sweeps.' }
  if (!Number.isFinite(input.cadenceHours) || input.cadenceHours < 1 || input.cadenceHours > 8760) {
    return { error: 'Cadence must be between 1 hour and a year.' }
  }

  const db = getDb()
  const table = sourcesTable(vertical)
  const [clash] = await db.select({ id: table.id }).from(table).where(eq(table.kind, kind)).limit(1)
  if (clash) return { error: `There is already a ${kind} row. Edit that one instead of adding a second.` }

  await db.insert(table).values({
    kind,
    label,
    target,
    cadenceHours: Math.round(input.cadenceHours),
    notes: input.notes?.trim() || null,
  })
  return {}
}

/** The path a source action should revalidate. */
export function listingSourcesPath(vertical: ListingVertical): string {
  return SOURCES_PATH[vertical]
}

// #endregion
