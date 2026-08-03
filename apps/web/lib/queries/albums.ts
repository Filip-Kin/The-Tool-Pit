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

/**
 * Display name for an event. TBA event_type 4 is the Championship Finals, whose
 * TBA name is just "Einstein Field" - but album photos there span the whole
 * championship, so we present it as the world championship instead.
 */
export function displayEventName(e: Pick<Event, 'name' | 'eventType' | 'year'>): string {
  if (e.eventType === 4) return `${e.year} FRC World Championship`
  return e.name
}

function toEventResult(e: Event, albumCount: number, coverImages: string[] = []): EventSearchResult {
  return {
    id: e.id,
    tbaKey: e.tbaKey,
    eventCode: e.eventCode,
    name: displayEventName(e),
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
// Championship division roll-up
// A championship (event_type 2 or 4) has divisions (event_type 5 or 3) whose
// code is the parent code + a digit, e.g. micmp -> micmp1..micmp4. In lists the
// divisions collapse under the parent; the event page shows them as sections.
// ---------------------------------------------------------------------------

const CMP_PARENT_TYPES = new Set([2, 4])
const CMP_DIVISION_TYPES = new Set([3, 5])

function isDivision(e: Pick<Event, 'eventType' | 'eventCode'>): boolean {
  return CMP_DIVISION_TYPES.has(e.eventType ?? -1) && /\d$/.test(e.eventCode)
}
function baseCode(code: string): string {
  return code.replace(/\d+$/, '')
}
/** "FIM State Championship - DTE Energy Foundation Division" -> "DTE Energy Foundation Division". */
export function divisionLabel(name: string): string {
  const parts = name.split(' - ')
  return parts.length > 1 ? parts[parts.length - 1].trim() : name
}

/**
 * Collapse championship divisions into their parent for list display, summing
 * album counts and merging cover previews.
 */
async function collapseDivisions(
  rows: Event[],
  counts: Map<string, number>,
  covers: Map<string, string[]>,
): Promise<EventSearchResult[]> {
  const db = getDb()
  // Fetch parent events for any divisions present.
  const parentKeys = [...new Set(rows.filter(isDivision).map((r) => `${r.year}${baseCode(r.eventCode)}`))]
  const parentByKey = new Map<string, Event>()
  if (parentKeys.length > 0) {
    const parents = await db.select().from(events).where(inArray(events.tbaKey, parentKeys))
    for (const p of parents) parentByKey.set(p.tbaKey, p)
  }

  const groups = new Map<string, { event: Event; memberIds: string[] }>()
  const add = (event: Event, memberId: string) => {
    const g = groups.get(event.tbaKey) ?? { event, memberIds: [] }
    g.memberIds.push(memberId)
    groups.set(event.tbaKey, g)
  }
  for (const r of rows) {
    const parent = isDivision(r) ? parentByKey.get(`${r.year}${baseCode(r.eventCode)}`) : undefined
    add(parent ?? r, r.id)
  }

  const results = [...groups.values()].map((g) => {
    const count = g.memberIds.reduce((s, id) => s + (counts.get(id) ?? 0), 0)
    const cov: string[] = []
    for (const id of g.memberIds) for (const c of covers.get(id) ?? []) if (cov.length < PREVIEW_COVERS) cov.push(c)
    return toEventResult(g.event, count, cov)
  })
  results.sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
  return results
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * A page of events that have at least one published album, newest first, for the
 * infinite-scroll home page. Paginates over the raw event rows (offset counts raw
 * rows, not collapsed groups) so the caller can keep advancing; `rawCount` is how
 * many raw rows this page consumed and `hasMore` whether another page may exist.
 * Championship divisions still collapse into their parent, so the caller should
 * dedupe appended events by tbaKey.
 */
export async function getEventsByDatePage(
  opts: { limit?: number; offset?: number } = {},
): Promise<{ events: EventSearchResult[]; rawCount: number; hasMore: boolean }> {
  const db = getDb()
  const limit = opts.limit ?? 30
  const offset = opts.offset ?? 0

  const rows = await db
    .select()
    .from(events)
    .where(hasPublishedAlbum)
    .orderBy(desc(events.startDate))
    .limit(limit)
    .offset(offset)

  const ids = rows.map((e) => e.id)
  const [counts, covers] = await Promise.all([publishedAlbumCounts(ids), publishedAlbumCovers(ids)])
  return {
    events: await collapseDivisions(rows, counts, covers),
    rawCount: rows.length,
    hasMore: rows.length === limit,
  }
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

  // A year in the query (e.g. "2019 Southfield") filters by season; the rest is
  // the name/code text, since event names don't contain the year.
  const yearMatch = query.match(/\b(19|20)\d{2}\b/)
  const year = params.year ?? (yearMatch ? parseInt(yearMatch[0], 10) : undefined)
  const text = query.replace(/\b(19|20)\d{2}\b/, '').trim()

  const pattern = `%${text}%`
  const filters = [hasPublishedAlbum]
  if (text) filters.push(or(ilike(events.name, pattern), ilike(events.eventCode, pattern))!)
  if (year) filters.push(eq(events.year, year))
  const where = and(...filters)

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(events)
      .where(where)
      .orderBy(desc(sql`similarity(${events.name}, ${text})`), desc(events.startDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(events).where(where),
  ])

  const [counts, covers] = await Promise.all([
    publishedAlbumCounts(rows.map((r) => r.id)),
    publishedAlbumCovers(rows.map((r) => r.id)),
  ])
  return {
    events: await collapseDivisions(rows, counts, covers),
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

async function albumsForEvent(event: Event): Promise<AlbumDTO[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(albums)
    .where(and(eq(albums.eventId, event.id), eq(albums.status, 'published')))
    .orderBy(desc(albums.publishedAt))
  return rows.map((a) => toAlbumDTO(a, event.eventCode))
}

export interface EventPageDivision {
  event: Event
  label: string
  albums: AlbumDTO[]
}
export interface EventPageData {
  event: Event
  /** Canonical parent key; if the viewed key was a division, redirect here. */
  parentTbaKey: string
  albums: AlbumDTO[]
  divisions: EventPageDivision[]
}

/**
 * Event page data with championship division roll-up. Viewing a division key
 * resolves to its parent; the page shows the parent's albums plus one section
 * per division that has albums.
 */
export async function getEventPage(tbaKey: string): Promise<EventPageData | null> {
  const db = getDb()
  const viewed = await resolveEvent(tbaKey)
  if (!viewed) return null

  // Resolve to the parent championship if a division key was viewed.
  let parent = viewed
  if (isDivision(viewed)) {
    const [p] = await db
      .select()
      .from(events)
      .where(and(eq(events.eventCode, baseCode(viewed.eventCode)), eq(events.year, viewed.year)))
      .limit(1)
    if (p && CMP_PARENT_TYPES.has(p.eventType ?? -1)) parent = p
  }

  const parentAlbums = await albumsForEvent(parent)

  // Division events of this parent (code = parentCode + digits).
  const divisionRows = CMP_PARENT_TYPES.has(parent.eventType ?? -1)
    ? await db
        .select()
        .from(events)
        .where(and(eq(events.year, parent.year), sql`${events.eventCode} ~ ${`^${baseCode(parent.eventCode)}[0-9]+$`}`))
        .orderBy(events.eventCode)
    : []

  const divisions: EventPageDivision[] = []
  for (const d of divisionRows) {
    if (d.id === parent.id) continue
    const alb = await albumsForEvent(d)
    if (alb.length > 0) divisions.push({ event: d, label: divisionLabel(d.name), albums: alb })
  }

  return { event: parent, parentTbaKey: parent.tbaKey, albums: parentAlbums, divisions }
}

/** Events a team attended that have at least one published album, newest first. */
export async function getTeamEvents(teamNumber: number): Promise<EventSearchResult[]> {
  const db = getDb()
  const rows = await db
    .select({ event: events })
    .from(eventTeams)
    .innerJoin(events, eq(events.id, eventTeams.eventId))
    .where(and(eq(eventTeams.teamNumber, teamNumber), hasPublishedAlbum))
    .orderBy(desc(events.startDate))
  const eventRows = rows.map((r) => r.event)
  const [counts, covers] = await Promise.all([
    publishedAlbumCounts(eventRows.map((e) => e.id)),
    publishedAlbumCovers(eventRows.map((e) => e.id)),
  ])
  return collapseDivisions(eventRows, counts, covers)
}

/** Lightweight autocomplete: top event name/code matches. */
export async function suggestEvents(q: string, limit = 5): Promise<EventSearchResult[]> {
  const db = getDb()
  const query = q.trim()
  if (query.length < 2) return []
  const yearMatch = query.match(/\b(19|20)\d{2}\b/)
  const year = yearMatch ? parseInt(yearMatch[0], 10) : undefined
  const text = query.replace(/\b(19|20)\d{2}\b/, '').trim()
  const pattern = `%${text}%`
  const filters = [hasPublishedAlbum]
  if (text) filters.push(or(ilike(events.name, pattern), ilike(events.eventCode, pattern))!)
  if (year) filters.push(eq(events.year, year))
  const rows = await db
    .select()
    .from(events)
    .where(and(...filters))
    .orderBy(desc(sql`similarity(${events.name}, ${text})`), desc(events.startDate))
    .limit(limit)
  return rows.map((e) => toEventResult(e, 0))
}
