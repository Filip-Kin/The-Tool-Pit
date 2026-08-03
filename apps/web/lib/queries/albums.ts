import { sql, eq, and, or, ilike, desc, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { events, albums, eventTeams } from '@the-tool-pit/db'
import type { Event, Album } from '@the-tool-pit/db'
import type { EventSearchResult, AlbumDTO } from '@the-tool-pit/types'

/** How many album cover images to surface per event card. */
const PREVIEW_COVERS = 4

/** SQL predicate: the event has at least one published album. */
const hasPublishedAlbum = sql`exists (select 1 from albums a where a.event_id = ${events.id} and a.status = 'published')`

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toEventResult(e: Event, albumCount: number, coverImages: string[] = []): EventSearchResult {
  return {
    id: e.id,
    tbaKey: e.tbaKey,
    eventCode: e.eventCode,
    name: e.name,
    year: e.year,
    startDate: e.startDate,
    endDate: e.endDate,
    week: e.week,
    eventType: e.eventType,
    city: e.city,
    stateProv: e.stateProv,
    country: e.country,
    albumCount,
    coverImages,
  }
}

function toAlbumDTO(a: Album, eventCode: string): AlbumDTO {
  return {
    id: a.id,
    url: a.url,
    provider: a.provider,
    title: a.title,
    photographer: a.photographer,
    description: a.description,
    dateText: a.dateText,
    coverImageUrl: a.coverImageUrl,
    photoCount: a.photoCount,
    eventCode,
  }
}

/** Published-album counts for a set of event IDs. */
async function publishedAlbumCounts(eventIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (eventIds.length === 0) return map
  const db = getDb()
  const rows = await db
    .select({ eventId: albums.eventId, count: sql<number>`count(*)::int` })
    .from(albums)
    .where(and(inArray(albums.eventId, eventIds), eq(albums.status, 'published')))
    .groupBy(albums.eventId)
  for (const r of rows) map.set(r.eventId, r.count)
  return map
}

/** Up to PREVIEW_COVERS album cover images per event, for card previews. */
async function publishedAlbumCovers(eventIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (eventIds.length === 0) return map
  const db = getDb()
  const rows = await db
    .select({ eventId: albums.eventId, coverImageUrl: albums.coverImageUrl })
    .from(albums)
    .where(
      and(inArray(albums.eventId, eventIds), eq(albums.status, 'published'), isNotNull(albums.coverImageUrl)),
    )
    .orderBy(desc(albums.publishedAt))
  for (const r of rows) {
    if (!r.coverImageUrl) continue
    const arr = map.get(r.eventId) ?? []
    if (arr.length < PREVIEW_COVERS) {
      arr.push(r.coverImageUrl)
      map.set(r.eventId, arr)
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Events that have at least one published album, most recent first. */
export async function getEventsByDate(limit = 60): Promise<EventSearchResult[]> {
  const db = getDb()
  const counts = await db
    .select({ eventId: albums.eventId, count: sql<number>`count(*)::int` })
    .from(albums)
    .where(eq(albums.status, 'published'))
    .groupBy(albums.eventId)
  if (counts.length === 0) return []
  const countMap = new Map(counts.map((c) => [c.eventId, c.count]))
  const ids = [...countMap.keys()]

  const rows = await db
    .select()
    .from(events)
    .where(inArray(events.id, ids))
    .orderBy(desc(events.startDate))
    .limit(limit)

  const covers = await publishedAlbumCovers(rows.map((e) => e.id))
  return rows.map((e) => toEventResult(e, countMap.get(e.id) ?? 0, covers.get(e.id) ?? []))
}

export async function searchEvents(params: {
  query: string
  year?: number
  page?: number
  pageSize?: number
}): Promise<{ events: EventSearchResult[]; total: number }> {
  const db = getDb()
  const query = params.query.trim()
  const page = Math.max(1, params.page ?? 1)
  const pageSize = params.pageSize ?? 20
  if (!query) return { events: [], total: 0 }

  const pattern = `%${query}%`
  const filters = [or(ilike(events.name, pattern), ilike(events.eventCode, pattern)), hasPublishedAlbum]
  if (params.year) filters.push(eq(events.year, params.year))
  const where = and(...filters)

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(events)
      .where(where)
      .orderBy(desc(sql`similarity(${events.name}, ${query})`), desc(events.startDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(events).where(where),
  ])

  const [counts, covers] = await Promise.all([
    publishedAlbumCounts(rows.map((r) => r.id)),
    publishedAlbumCovers(rows.map((r) => r.id)),
  ])
  return {
    events: rows.map((e) => toEventResult(e, counts.get(e.id) ?? 0, covers.get(e.id) ?? [])),
    total: totalRows[0]?.count ?? 0,
  }
}

/**
 * Resolve an event by its full TBA key ("2026mimid"). The year is mandatory:
 * event codes repeat every season, so a bare code is never accepted here.
 */
export async function resolveEvent(tbaKey: string): Promise<Event | null> {
  const value = tbaKey.trim().toLowerCase()
  if (!/^(19|20)\d{2}[a-z0-9]+$/.test(value)) return null
  const db = getDb()
  const [row] = await db.select().from(events).where(eq(events.tbaKey, value)).limit(1)
  return row ?? null
}

/** An event plus its published albums, keyed by TBA key or bare code. */
export async function getEventWithAlbums(
  keyOrCode: string,
): Promise<{ event: Event; albums: AlbumDTO[] } | null> {
  const db = getDb()
  const event = await resolveEvent(keyOrCode)
  if (!event) return null
  const albumRows = await db
    .select()
    .from(albums)
    .where(and(eq(albums.eventId, event.id), eq(albums.status, 'published')))
    .orderBy(desc(albums.publishedAt))
  return { event, albums: albumRows.map((a) => toAlbumDTO(a, event.eventCode)) }
}

/** Events a team attended, most recent first, with album counts. */
export async function getTeamEvents(teamNumber: number): Promise<EventSearchResult[]> {
  const db = getDb()
  const rows = await db
    .select({ event: events })
    .from(eventTeams)
    .innerJoin(events, eq(events.id, eventTeams.eventId))
    .where(eq(eventTeams.teamNumber, teamNumber))
    .orderBy(desc(events.startDate))
  const eventRows = rows.map((r) => r.event)
  const [counts, covers] = await Promise.all([
    publishedAlbumCounts(eventRows.map((e) => e.id)),
    publishedAlbumCovers(eventRows.map((e) => e.id)),
  ])
  return eventRows.map((e) => toEventResult(e, counts.get(e.id) ?? 0, covers.get(e.id) ?? []))
}

/** Lightweight autocomplete: top event name/code matches. */
export async function suggestEvents(q: string, limit = 5): Promise<EventSearchResult[]> {
  const db = getDb()
  const query = q.trim()
  if (query.length < 2) return []
  const pattern = `%${query}%`
  const rows = await db
    .select()
    .from(events)
    .where(and(or(ilike(events.name, pattern), ilike(events.eventCode, pattern)), hasPublishedAlbum))
    .orderBy(desc(sql`similarity(${events.name}, ${query})`), desc(events.startDate))
    .limit(limit)
  return rows.map((e) => toEventResult(e, 0))
}
