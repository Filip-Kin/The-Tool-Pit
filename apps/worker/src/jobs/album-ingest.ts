/**
 * Album ingest job.
 * - tba_events: syncs events + team rosters directly (TBA is authoritative).
 * - fim_albums / chief_delphi_albums: discovers album candidates, dedups them,
 *   and enqueues each for enrichment/matching before moderation.
 */
import { getDb } from '@the-tool-pit/db'
import { events, eventTeams, albums, albumCandidates, albumCrawlJobs, canonicalizeAlbumUrl, resolveShareUrl } from '@the-tool-pit/db'
import { eq, and, or, inArray, isNull, ne, sql } from 'drizzle-orm'
import { TbaEventsConnector } from '../connectors/tba-events.js'
import { ToaEventsConnector, yearToSeasonKey } from '../connectors/toa-events.js'
import { FimAlbumsConnector } from '../connectors/fim-albums.js'
import { ChiefDelphiAlbumsConnector } from '../connectors/chief-delphi-albums.js'
import { FlickrAlbumsConnector } from '../connectors/flickr-albums.js'
import { SmugmugAlbumsConnector } from '../connectors/smugmug-albums.js'
import type { AlbumConnector } from '../connectors/album-hosts.js'
import { albumEnrichQueue } from '../queues.js'
import type { AlbumIngestPayload } from '@the-tool-pit/types'
import { sendApprovalNotice, reviewQueueUrl } from '@the-tool-pit/types'

const ALBUM_CONNECTOR_REGISTRY: Record<string, () => AlbumConnector> = {
  fim_albums: () => new FimAlbumsConnector(),
  chief_delphi_albums: () => new ChiefDelphiAlbumsConnector(),
  flickr_albums: () => new FlickrAlbumsConnector(),
  smugmug_albums: () => new SmugmugAlbumsConnector(),
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function processAlbumIngestJob(payload: AlbumIngestPayload): Promise<void> {
  const db = getDb()
  const connectorName = payload.connector
  const year = payload.year ?? new Date().getFullYear()

  const [jobRecord] = await db
    .insert(albumCrawlJobs)
    .values({ connector: connectorName, status: 'running', startedAt: new Date() })
    .returning({ id: albumCrawlJobs.id })
  const jobId = jobRecord.id

  try {
    if (connectorName === 'tba_events') {
      const stats = await syncTbaEvents(year, { skipTeams: payload.options?.skipTeams === true })
      await db
        .update(albumCrawlJobs)
        .set({ status: 'done', finishedAt: new Date(), stats })
        .where(eq(albumCrawlJobs.id, jobId))
      return
    }

    if (connectorName === 'toa_events') {
      const stats = await syncToaEvents(year, { skipTeams: payload.options?.skipTeams === true })
      await db
        .update(albumCrawlJobs)
        .set({ status: 'done', finishedAt: new Date(), stats })
        .where(eq(albumCrawlJobs.id, jobId))
      return
    }

    if (connectorName === 'reanalyze_candidates') {
      const stats = await reanalyzeCandidates()
      await db
        .update(albumCrawlJobs)
        .set({ status: 'done', finishedAt: new Date(), stats })
        .where(eq(albumCrawlJobs.id, jobId))
      return
    }

    const factory = ALBUM_CONNECTOR_REGISTRY[connectorName]
    if (!factory) throw new Error(`Unknown album connector: ${connectorName}`)

    const result = await factory().run(year)
    let totalNew = 0
    let totalSkipped = 0
    let totalFailed = 0

    for (const cand of result.candidates) {
      try {
        // Resolve short share links (e.g. photos.app.goo.gl) to their canonical album URL so
        // both the short and expanded form of the same album dedupe to one entry.
        let canonicalUrl = cand.canonicalUrl
        let provider = cand.provider
        const resolved = await resolveShareUrl(canonicalUrl)
        if (resolved !== canonicalUrl) {
          const rc = canonicalizeAlbumUrl(resolved, { allowUnknown: true })
          if (rc) { canonicalUrl = rc.canonicalUrl; provider = rc.provider }
        }

        // Dedup vs published albums and existing candidates on canonical URL.
        const [dupAlbum] = await db
          .select({ id: albums.id })
          .from(albums)
          .where(eq(albums.canonicalUrl, canonicalUrl))
          .limit(1)
        if (dupAlbum) {
          totalSkipped++
          continue
        }
        const [dupCand] = await db
          .select({ id: albumCandidates.id })
          .from(albumCandidates)
          .where(eq(albumCandidates.canonicalUrl, canonicalUrl))
          .limit(1)
        if (dupCand) {
          totalSkipped++
          continue
        }

        const [stored] = await db
          .insert(albumCandidates)
          .values({
            jobId,
            sourceUrl: cand.sourceUrl,
            canonicalUrl,
            provider,
            targetEventCode: cand.targetEventCode,
            targetEventYear: cand.targetEventYear,
            rawMetadata: cand.rawMetadata,
            status: 'pending',
          })
          .returning({ id: albumCandidates.id })

        await albumEnrichQueue.add('album-enrich', { candidateId: stored.id })
        totalNew++
      } catch (err) {
        totalFailed++
        console.error('[album-ingest] error processing candidate:', err)
      }
    }

    await db
      .update(albumCrawlJobs)
      .set({
        status: 'done',
        finishedAt: new Date(),
        stats: {
          discovered: result.candidates.length,
          new: totalNew,
          matched: 0,
          skipped: totalSkipped,
          failed: totalFailed,
        },
      })
      .where(eq(albumCrawlJobs.id, jobId))

    console.log(`[album-ingest] ${connectorName} done: ${totalNew} new, ${totalSkipped} skipped, ${totalFailed} failed`)

    // One summary per run. See the same block in jobs/crawl.ts for why.
    if (totalNew > 0) {
      sendApprovalNotice({
        vertical: 'crawl',
        title: `${connectorName} found ${totalNew} new album${totalNew === 1 ? '' : 's'}`,
        reviewUrl: reviewQueueUrl('/admin/album-candidates?status=pending'),
        description: `${totalNew} candidate${totalNew === 1 ? '' : 's'} waiting in the albums queue.`,
        facts: [
          { label: 'Connector', value: connectorName, inline: true },
          { label: 'Season', value: year, inline: true },
          { label: 'Discovered', value: result.candidates.length, inline: true },
          { label: 'New', value: totalNew, inline: true },
          { label: 'Skipped', value: totalSkipped, inline: true },
          { label: 'Failed', value: totalFailed || null, inline: true },
        ],
      })
    }
  } catch (err) {
    await db
      .update(albumCrawlJobs)
      .set({ status: 'failed', finishedAt: new Date(), error: String(err) })
      .where(eq(albumCrawlJobs.id, jobId))
    throw err
  }
}

/**
 * Re-run the matcher over candidates that aren't finalized. Resets eligible
 * candidates to 'pending' and re-enqueues enrich for each. Eligible = currently
 * pending, OR matched by the algorithm (NOT admin-set) and not yet published.
 * Admin-set matches (classification.reasoning = 'Admin-set'), published, and
 * suppressed/duplicate candidates are left untouched. Used after adding new
 * events (e.g. FTC) or when AI credits become available.
 */
async function reanalyzeCandidates() {
  const db = getDb()
  // Matched-but-not-admin: status matched and the classification method isn't
  // the admin sentinel. (Admin sets method 'none' + reasoning 'Admin-set'.)
  const notAdminSet = sql`coalesce(${albumCandidates.classification}->>'reasoning','') <> 'Admin-set'`
  const eligible = or(
    eq(albumCandidates.status, 'pending'),
    and(eq(albumCandidates.status, 'matched'), notAdminSet),
  )

  const rows = await db.select({ id: albumCandidates.id }).from(albumCandidates).where(eligible)
  // Reset matched->pending so the enrich job (which only runs on 'pending') will
  // reprocess them; clear the stale match so a wrong old match can't linger.
  await db
    .update(albumCandidates)
    .set({ status: 'pending', matchedEventId: null, updatedAt: new Date() })
    .where(and(eligible!, ne(albumCandidates.status, 'pending')))

  for (const r of rows) {
    await albumEnrichQueue.add('album-enrich', { candidateId: r.id })
  }
  console.log(`[album-ingest] reanalyze: re-enqueued ${rows.length} candidates`)
  return { discovered: rows.length, new: 0, matched: 0, skipped: 0, failed: 0 }
}

/** Upsert events + rebuild event_teams for a season. */
async function syncTbaEvents(year: number, opts: { skipTeams?: boolean } = {}) {
  const db = getDb()
  const { events: rows, eventTeams: teamsByKey } = await new TbaEventsConnector().run(year, opts)

  if (rows.length === 0) {
    return { discovered: 0, new: 0, matched: 0, skipped: 0, failed: 0, eventsUpserted: 0, eventTeamsUpserted: 0 }
  }

  // Upsert events (keyed on tba_key).
  for (const batch of chunk(rows, 200)) {
    await db
      .insert(events)
      .values(
        batch.map((e) => ({
          tbaKey: e.tbaKey,
          eventCode: e.eventCode,
          year: e.year,
          name: e.name,
          shortName: e.shortName,
          startDate: e.startDate,
          endDate: e.endDate,
          week: e.week,
          eventType: e.eventType,
          eventTypeString: e.eventTypeString,
          city: e.city,
          stateProv: e.stateProv,
          country: e.country,
          venue: e.venue,
          website: e.website,
        })),
      )
      .onConflictDoUpdate({
        target: events.tbaKey,
        set: {
          eventCode: sql`excluded.event_code`,
          year: sql`excluded.year`,
          name: sql`excluded.name`,
          shortName: sql`excluded.short_name`,
          startDate: sql`excluded.start_date`,
          endDate: sql`excluded.end_date`,
          week: sql`excluded.week`,
          eventType: sql`excluded.event_type`,
          eventTypeString: sql`excluded.event_type_string`,
          city: sql`excluded.city`,
          stateProv: sql`excluded.state_prov`,
          country: sql`excluded.country`,
          venue: sql`excluded.venue`,
          website: sql`excluded.website`,
          updatedAt: new Date(),
        },
      })
  }

  // Map tbaKey → id for this season.
  const keyToId = new Map<string, string>()
  for (const batch of chunk(rows.map((r) => r.tbaKey), 500)) {
    const ids = await db.select({ id: events.id, tbaKey: events.tbaKey }).from(events).where(inArray(events.tbaKey, batch))
    for (const row of ids) keyToId.set(row.tbaKey, row.id)
  }

  // Rebuild event_teams for events we have fresh rosters for.
  const teamRows: { eventId: string; teamNumber: number }[] = []
  const eventIdsWithTeams: string[] = []
  for (const [tbaKey, numbers] of teamsByKey) {
    const eventId = keyToId.get(tbaKey)
    if (!eventId) continue
    eventIdsWithTeams.push(eventId)
    for (const n of numbers) teamRows.push({ eventId, teamNumber: n })
  }

  for (const batch of chunk(eventIdsWithTeams, 200)) {
    await db.delete(eventTeams).where(inArray(eventTeams.eventId, batch))
  }
  for (const batch of chunk(teamRows, 1000)) {
    if (batch.length > 0) await db.insert(eventTeams).values(batch).onConflictDoNothing()
  }

  console.log(`[album-ingest] tba_events ${year}: ${rows.length} events, ${teamRows.length} team memberships`)
  return {
    discovered: rows.length,
    new: rows.length,
    matched: 0,
    skipped: 0,
    failed: 0,
    eventsUpserted: rows.length,
    eventTeamsUpserted: teamRows.length,
  }
}

/** Upsert FTC events + rebuild their event_teams for a competition year (via TOA). */
async function syncToaEvents(year: number, opts: { skipTeams?: boolean } = {}) {
  const db = getDb()
  const seasonKey = yearToSeasonKey(year)
  const { events: rows, eventTeams: teamsByKey } = await new ToaEventsConnector().run(seasonKey, opts)

  if (rows.length === 0) {
    return { discovered: 0, new: 0, matched: 0, skipped: 0, failed: 0, eventsUpserted: 0, eventTeamsUpserted: 0 }
  }

  for (const batch of chunk(rows, 200)) {
    await db
      .insert(events)
      .values(
        batch.map((e) => ({
          program: e.program,
          tbaKey: e.tbaKey,
          sourceKey: e.sourceKey,
          eventCode: e.eventCode,
          year: e.year,
          name: e.name,
          startDate: e.startDate,
          endDate: e.endDate,
          eventTypeString: e.eventTypeString,
          city: e.city,
          stateProv: e.stateProv,
          country: e.country,
          venue: e.venue,
          website: e.website,
        })),
      )
      .onConflictDoUpdate({
        target: events.tbaKey,
        set: {
          program: sql`excluded.program`,
          sourceKey: sql`excluded.source_key`,
          eventCode: sql`excluded.event_code`,
          year: sql`excluded.year`,
          name: sql`excluded.name`,
          startDate: sql`excluded.start_date`,
          endDate: sql`excluded.end_date`,
          eventTypeString: sql`excluded.event_type_string`,
          city: sql`excluded.city`,
          stateProv: sql`excluded.state_prov`,
          country: sql`excluded.country`,
          venue: sql`excluded.venue`,
          website: sql`excluded.website`,
          updatedAt: new Date(),
        },
      })
  }

  const keyToId = new Map<string, string>()
  for (const batch of chunk(rows.map((r) => r.tbaKey), 500)) {
    const ids = await db.select({ id: events.id, tbaKey: events.tbaKey }).from(events).where(inArray(events.tbaKey, batch))
    for (const row of ids) keyToId.set(row.tbaKey, row.id)
  }

  const teamRows: { eventId: string; teamNumber: number }[] = []
  const eventIdsWithTeams: string[] = []
  for (const [tbaKey, numbers] of teamsByKey) {
    const eventId = keyToId.get(tbaKey)
    if (!eventId) continue
    eventIdsWithTeams.push(eventId)
    for (const n of numbers) teamRows.push({ eventId, teamNumber: n })
  }

  for (const batch of chunk(eventIdsWithTeams, 200)) {
    await db.delete(eventTeams).where(inArray(eventTeams.eventId, batch))
  }
  for (const batch of chunk(teamRows, 1000)) {
    if (batch.length > 0) await db.insert(eventTeams).values(batch).onConflictDoNothing()
  }

  console.log(`[album-ingest] toa_events ${year} (season ${seasonKey}): ${rows.length} events, ${teamRows.length} team memberships`)
  return {
    discovered: rows.length,
    new: rows.length,
    matched: 0,
    skipped: 0,
    failed: 0,
    eventsUpserted: rows.length,
    eventTeamsUpserted: teamRows.length,
  }
}
