import { eq, and, or, ne, isNull, isNotNull, gte, lt, asc, desc, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListings, eventRosterSnapshots, currentOffseasonSeason } from '@the-tool-pit/db'
import { slugify } from '@/lib/utils/slugify'
import type { PublicEvent, SeasonScope } from '@/lib/events/event-display'
import type { RegistrationStatus, VolunteerStatus, EventStatus } from '@the-tool-pit/db'

/** Columns exposed publicly - never the submitter audit fields. */
const publicColumns = {
  id: eventListings.id,
  slug: eventListings.slug,
  program: eventListings.program,
  name: eventListings.name,
  hostTeamNumber: eventListings.hostTeamNumber,
  seasonYear: eventListings.seasonYear,
  previousListingId: eventListings.previousListingId,
  latitude: eventListings.latitude,
  longitude: eventListings.longitude,
  venueName: eventListings.venueName,
  address: eventListings.address,
  city: eventListings.city,
  region: eventListings.region,
  country: eventListings.country,
  startDate: eventListings.startDate,
  endDate: eventListings.endDate,
  days: eventListings.days,
  parallelDivisions: eventListings.parallelDivisions,
  capacity: eventListings.capacity,
  costUsd: eventListings.costUsd,
  costNote: eventListings.costNote,
  registrationStatus: eventListings.registrationStatus,
  registrationOpensAt: eventListings.registrationOpensAt,
  registrationClosesAt: eventListings.registrationClosesAt,
  volunteerStatus: eventListings.volunteerStatus,
  eventStatus: eventListings.eventStatus,
  website: eventListings.website,
  registrationUrl: eventListings.registrationUrl,
  volunteerUrl: eventListings.volunteerUrl,
  chiefDelphiUrl: eventListings.chiefDelphiUrl,
  contactEmail: eventListings.contactEmail,
  notes: eventListings.notes,
  tbaKey: eventListings.tbaKey,
  registeredTeamCount: eventListings.registeredTeamCount,
  teamCountUpdatedAt: eventListings.teamCountUpdatedAt,
} as const

function toPublic(row: Record<string, unknown>): PublicEvent {
  return {
    ...row,
    registrationStatus: row.registrationStatus as RegistrationStatus,
    volunteerStatus: row.volunteerStatus as VolunteerStatus,
    eventStatus: row.eventStatus as EventStatus,
    teamCountUpdatedAt:
      row.teamCountUpdatedAt instanceof Date ? row.teamCountUpdatedAt.toISOString() : (row.teamCountUpdatedAt as string | null),
  } as PublicEvent
}

/** Published, and placeable on the map. The floor under every list query here. */
const isOnTheMap = and(
  eq(eventListings.status, 'published'),
  isNotNull(eventListings.latitude),
  isNotNull(eventListings.longitude),
)

/**
 * The season filter, as SQL.
 *
 * 'current' is the default view: this calendar year, anything already dated
 * into a later year, and anything with no season at all. 'earlier' is the
 * opposite set, the finished seasons.
 *
 * The two are exhaustive and do not overlap, so nothing published can fall
 * between them and become unreachable. Filtering HERE rather than in the
 * explorer matters: it means a page that has accumulated eight years of
 * listings still sends the browser one year of them.
 */
function seasonFilter(scope: SeasonScope, currentSeason: number) {
  return scope === 'earlier'
    ? lt(eventListings.seasonYear, currentSeason)
    : or(gte(eventListings.seasonYear, currentSeason), isNull(eventListings.seasonYear))
}

export interface PublishedEventsOptions {
  /** Which seasons to return. Defaults to the season we are in. */
  scope?: SeasonScope
  /** Pinned by the caller so the page, the query and the client agree. */
  now?: Date
}

/**
 * All published events that have coordinates (so they can be placed on the
 * map), for one season scope. Ordered by start date ascending, nulls last, so
 * the natural list order already leads with what is coming up. The explorer
 * re-sorts for "past below upcoming" and "nearest first", but this is the
 * stable default.
 */
export async function getPublishedEvents(opts: PublishedEventsOptions = {}): Promise<PublicEvent[]> {
  const db = getDb()
  const scope = opts.scope ?? 'current'
  const currentSeason = currentOffseasonSeason(opts.now ?? new Date())

  const rows = await db
    .select(publicColumns)
    .from(eventListings)
    .where(and(isOnTheMap, seasonFilter(scope, currentSeason)))
    // asc puts nulls last in Postgres, which is what we want (dateless events
    // sink below dated ones). The earlier-years view wants the opposite: the
    // most recent finished season should lead, not the oldest one on file.
    .orderBy(
      scope === 'earlier' ? desc(eventListings.startDate) : asc(eventListings.startDate),
      desc(eventListings.createdAt),
    )
  return rows.map(toPublic)
}

/**
 * How many published listings sit in finished seasons.
 *
 * Only used to label the button into the earlier-years view. A button that
 * says "Earlier years" with nothing behind it is a dead end, so when this is
 * zero the button is not rendered at all.
 */
export async function countArchivedEvents(now: Date = new Date()): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(eventListings)
    .where(and(isOnTheMap, seasonFilter('earlier', currentOffseasonSeason(now))))
  return row?.n ?? 0
}

/**
 * A single published event by id, for its shareable detail page.
 *
 * DELIBERATELY NOT SEASON FILTERED, and this is the point of the whole design.
 * Archiving hides a finished season from the default LIST. It never takes a
 * page down. Those URLs get posted on Chief Delphi and sat in for years, and a
 * link that 404s in January because a calendar rolled over is exactly what
 * "history stays readable" rules out.
 */
export async function getPublishedEventById(id: string): Promise<PublicEvent | null> {
  const db = getDb()
  const [row] = await db
    .select(publicColumns)
    .from(eventListings)
    .where(and(eq(eventListings.id, id), eq(eventListings.status, 'published')))
    .limit(1)
  return row ? toPublic(row) : null
}

/**
 * A single published event by its human slug, for its shareable detail page.
 *
 * The slug is the canonical public key now, the same way tools and grants
 * resolve. Not season filtered, for the same reason getPublishedEventById is
 * not: archiving hides a finished season from the LIST, it never takes a page
 * down.
 */
export async function getPublishedEventBySlug(slug: string): Promise<PublicEvent | null> {
  const db = getDb()
  const [row] = await db
    .select(publicColumns)
    .from(eventListings)
    .where(and(eq(eventListings.slug, slug), eq(eventListings.status, 'published')))
    .limit(1)
  return row ? toPublic(row) : null
}

/**
 * A slug nobody else in event_listings is using, built from the name. Mirrors
 * uniqueGrantSlug: `ignoreId` lets a row keep its own slug across a rename so
 * the slug is stable once set. The suffix loop makes it globally unique.
 */
export async function uniqueEventSlug(base: string, ignoreId?: string): Promise<string> {
  const db = getDb()
  const root = (slugify(base) || 'event').slice(0, 80)
  let slug = root
  for (let attempt = 1; ; attempt++) {
    const [clash] = await db
      .select({ id: eventListings.id })
      .from(eventListings)
      .where(ignoreId ? and(eq(eventListings.slug, slug), ne(eventListings.id, ignoreId)) : eq(eventListings.slug, slug))
      .limit(1)
    if (!clash) return slug
    slug = `${root}-${attempt}`
  }
}

/**
 * Team numbers on every published listing's roster, keyed by listing id, for
 * one season scope.
 *
 * This is what the map's "team number" filter runs on. It is a SEPARATE fetch
 * and not part of getPublishedEvents on purpose: a roster is thirty-odd numbers
 * per event, and shipping every one of them inside the map payload would grow
 * the page for the large majority of readers who never type a team number. The
 * explorer asks for this once, the first time somebody uses that filter.
 *
 * Only the LATEST APPROVED snapshot per listing counts, the same gate the
 * public roster table uses: nothing scraped is public until a moderator has
 * approved it.
 *
 * WAITLISTED TEAMS ARE INCLUDED. registeredTeamCount leaves them out, since
 * they are not registered. This filter answers a different question, "is my
 * team on this event's list", and a team sitting fourth on a waitlist should
 * see the event. A second robot ("4145B") carries the same team number, so it
 * collapses into one entry.
 */
export async function getPublishedRosterTeams(
  opts: PublishedEventsOptions = {},
): Promise<Record<string, number[]>> {
  const db = getDb()
  const scope = opts.scope ?? 'current'
  const currentSeason = currentOffseasonSeason(opts.now ?? new Date())

  // DISTINCT ON is the one-line Postgres form of "latest row per group": order
  // by the group key then the recency key, and it keeps the first of each.
  const rows = await db
    .selectDistinctOn([eventRosterSnapshots.eventListingId], {
      eventListingId: eventRosterSnapshots.eventListingId,
      teams: eventRosterSnapshots.teams,
    })
    .from(eventRosterSnapshots)
    .innerJoin(eventListings, eq(eventListings.id, eventRosterSnapshots.eventListingId))
    .where(
      and(
        eq(eventRosterSnapshots.status, 'approved'),
        isOnTheMap,
        seasonFilter(scope, currentSeason),
      ),
    )
    .orderBy(eventRosterSnapshots.eventListingId, desc(eventRosterSnapshots.fetchedAt))

  const out: Record<string, number[]> = {}
  for (const row of rows) {
    const numbers = new Set<number>()
    for (const team of row.teams ?? []) {
      if (Number.isFinite(team?.number)) numbers.add(team.number)
    }
    if (numbers.size > 0) out[row.eventListingId] = [...numbers].sort((a, b) => a - b)
  }
  return out
}
