/**
 * Album ingest job.
 * - tba_events: syncs events + team rosters directly (TBA is authoritative).
 * - fim_albums / chief_delphi_albums: discovers album candidates, dedups them,
 *   and enqueues each for enrichment/matching before moderation.
 */
import { getDb } from '@the-tool-pit/db'
import { events, eventTeams, albums, albumCandidates, albumCrawlJobs } from '@the-tool-pit/db'
import { eq, inArray, sql } from 'drizzle-orm'
import { TbaEventsConnector } from '../connectors/tba-events.js'
import { FimAlbumsConnector } from '../connectors/fim-albums.js'
import { ChiefDelphiAlbumsConnector } from '../connectors/chief-delphi-albums.js'
import { FlickrAlbumsConnector } from '../connectors/flickr-albums.js'
import type { AlbumConnector } from '../connectors/album-hosts.js'
import { albumEnrichQueue } from '../queues.js'
import type { AlbumIngestPayload } from '@the-tool-pit/types'

const ALBUM_CONNECTOR_REGISTRY: Record<string, () => AlbumConnector> = {
  fim_albums: () => new FimAlbumsConnector(),
  chief_delphi_albums: () => new ChiefDelphiAlbumsConnector(),
  flickr_albums: () => new FlickrAlbumsConnector(),
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

    const factory = ALBUM_CONNECTOR_REGISTRY[connectorName]
    if (!factory) throw new Error(`Unknown album connector: ${connectorName}`)

    const result = await factory().run(year)
    let totalNew = 0
    let totalSkipped = 0
    let totalFailed = 0

    for (const cand of result.candidates) {
      try {
        // Dedup vs published albums and existing candidates on canonical URL.
        const [dupAlbum] = await db
          .select({ id: albums.id })
          .from(albums)
          .where(eq(albums.canonicalUrl, cand.canonicalUrl))
          .limit(1)
        if (dupAlbum) {
          totalSkipped++
          continue
        }
        const [dupCand] = await db
          .select({ id: albumCandidates.id })
          .from(albumCandidates)
          .where(eq(albumCandidates.canonicalUrl, cand.canonicalUrl))
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
            canonicalUrl: cand.canonicalUrl,
            provider: cand.provider,
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
  } catch (err) {
    await db
      .update(albumCrawlJobs)
      .set({ status: 'failed', finishedAt: new Date(), error: String(err) })
      .where(eq(albumCrawlJobs.id, jobId))
    throw err
  }
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
