import { sql, eq, and, or, ilike, desc, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { events, albums, eventTeams } from '@the-tool-pit/db'
import type { Event, Album } from '@the-tool-pit/db'
import type { EventSearchResult, AlbumDTO } from '@the-tool-pit/types'

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toEventResult(e: Event, albumCount: number): EventSearchResult {
  return {
    id: e.id,
    tbaKey: e.tbaKey,
    eventCode: e.eventCode,
    name: e.name,
    year: e.year,
    startDate: e.startDate,
    endDate: e.endDate,
    week: e.week,
    city: e.city,
    stateProv: e.stateProv,
    country: e.country,
    albumCount,
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

  return rows.map((e) => toEventResult(e, countMap.get(e.id) ?? 0))
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
  const filters = [or(ilike(events.name, pattern), ilike(events.eventCode, pattern))]
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

  const counts = await publishedAlbumCounts(rows.map((r) => r.id))
  return {
    events: rows.map((e) => toEventResult(e, counts.get(e.id) ?? 0)),
    total: totalRows[0]?.count ?? 0,
  }
}

/** Latest event matching a code (optionally a specific year). */
export async function getEventByCode(code: string, year?: number): Promise<Event | null> {
  const db = getDb()
  const filters = [eq(events.eventCode, code.toLowerCase())]
  if (year) filters.push(eq(events.year, year))
  const [row] = await db
    .select()
    .from(events)
    .where(and(...filters))
    .orderBy(desc(events.year))
    .limit(1)
  return row ?? null
}

/** An event plus its published albums. */
export async function getEventWithAlbums(
  code: string,
  year?: number,
): Promise<{ event: Event; albums: AlbumDTO[] } | null> {
  const db = getDb()
  const event = await getEventByCode(code, year)
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
  const counts = await publishedAlbumCounts(eventRows.map((e) => e.id))
  return eventRows.map((e) => toEventResult(e, counts.get(e.id) ?? 0))
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
    .where(or(ilike(events.name, pattern), ilike(events.eventCode, pattern)))
    .orderBy(desc(sql`similarity(${events.name}, ${query})`), desc(events.startDate))
    .limit(limit)
  return rows.map((e) => toEventResult(e, 0))
}
