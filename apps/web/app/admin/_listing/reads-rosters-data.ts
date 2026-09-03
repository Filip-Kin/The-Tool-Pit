import { and, desc, eq, isNotNull, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListings, eventRosterSnapshots } from '@the-tool-pit/db'
import type { RosterTeam } from '@the-tool-pit/db'

/**
 * The team-list crawl side of the reads inspector.
 *
 * The candidate read fills an event's fields. A separate pass keeps the event's
 * ROSTER current: for a listing with a team-list page it runs a stored parser
 * (teamListParser) over the page; for one coded in TBA it reads TBA. Each run
 * writes an event_roster_snapshots row. This is the moderator's view of what the
 * last team-list refresh produced, per published event.
 */

export interface RosterCrawlRow {
  listingId: string
  name: string
  /** The event's own team-list page, when it publishes one. */
  teamListUrl: string | null
  /** TBA key, the other roster source. */
  tbaKey: string | null
  /** Does a generated parser exist for the team-list page? */
  hasParser: boolean
  /** The public count from the latest APPROVED snapshot. */
  registeredTeamCount: number | null
  /** When the parser was last (re)written. */
  parserUpdatedAt: Date | null
  /** When the public count was last refreshed. */
  countUpdatedAt: Date | null
  /** fetchedAt of the newest snapshot of any status. */
  lastSnapshotAt: Date | null
  /** Status of the newest snapshot: pending / approved / rejected. */
  lastSnapshotStatus: string | null
  /** Team count on the newest snapshot. */
  lastSnapshotTeamCount: number | null
}

export interface RosterCrawlsResult {
  rows: RosterCrawlRow[]
  total: number
}

/**
 * Published events with a roster source, newest refresh first.
 *
 * Only published listings, because an unpublished event's roster is not yet a
 * public number. Either source qualifies: a team-list URL (site scrape) or a
 * TBA key (authoritative once the event is coded there).
 */
export async function getRosterCrawls(page: number, pageSize: number): Promise<RosterCrawlsResult> {
  const db = getDb()

  const where = and(
    eq(eventListings.status, 'published'),
    or(isNotNull(eventListings.teamListUrl), isNotNull(eventListings.tbaKey)),
  )

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        listingId: eventListings.id,
        name: eventListings.name,
        teamListUrl: eventListings.teamListUrl,
        tbaKey: eventListings.tbaKey,
        teamListParser: eventListings.teamListParser,
        registeredTeamCount: eventListings.registeredTeamCount,
        parserUpdatedAt: eventListings.teamListParserUpdatedAt,
        countUpdatedAt: eventListings.teamCountUpdatedAt,
      })
      .from(eventListings)
      .where(where)
      // Most-recently-refreshed first: the count timestamp is the freshest
      // signal a roster moved, and a listing never counted falls to the back.
      .orderBy(sql`${eventListings.teamCountUpdatedAt} desc nulls last`, desc(eventListings.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(eventListings).where(where),
  ])

  const listingIds = rows.map((r) => r.listingId)
  // Newest snapshot per listing, any status, in one grouped read rather than a
  // query per row.
  const latest = listingIds.length
    ? await db.execute<{ event_listing_id: string; fetched_at: string; status: string; team_count: number | null }>(sql`
        select distinct on (event_listing_id)
          event_listing_id, fetched_at, status, team_count
        from event_roster_snapshots
        where event_listing_id in (${sql.join(listingIds.map((id) => sql`${id}`), sql`, `)})
        order by event_listing_id, fetched_at desc
      `)
    : []
  const latestByListing = new Map(latest.map((r) => [r.event_listing_id, r]))

  return {
    rows: rows.map((r) => {
      const snap = latestByListing.get(r.listingId)
      return {
        listingId: r.listingId,
        name: r.name,
        teamListUrl: r.teamListUrl,
        tbaKey: r.tbaKey,
        hasParser: Boolean(r.teamListParser),
        registeredTeamCount: r.registeredTeamCount,
        parserUpdatedAt: r.parserUpdatedAt,
        countUpdatedAt: r.countUpdatedAt,
        lastSnapshotAt: snap?.fetched_at ? new Date(snap.fetched_at) : null,
        lastSnapshotStatus: snap?.status ?? null,
        lastSnapshotTeamCount: snap?.team_count ?? null,
      }
    }),
    total: totals?.n ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Roster detail: the latest snapshot for one listing
// ---------------------------------------------------------------------------

export interface RosterCrawlDetail {
  listingId: string
  name: string
  teamListUrl: string | null
  tbaKey: string | null
  hasParser: boolean
  parserSourceUrl: string | null
  parserUpdatedAt: Date | null
  registeredTeamCount: number | null
  snapshot: {
    id: string
    sourceUrl: string
    fetchedAt: Date
    httpStatus: number | null
    teamCount: number | null
    status: string
    changed: boolean
    /**
     * The held reason on a rejected snapshot: leaked slot indices, an emptied
     * roster, or too many teams gone. This is the suspect/leak flag.
     */
    error: string | null
    teams: RosterTeam[]
  } | null
}

export async function getRosterCrawlDetail(listingId: string): Promise<RosterCrawlDetail | null> {
  const db = getDb()

  const [listing] = await db
    .select({
      id: eventListings.id,
      name: eventListings.name,
      teamListUrl: eventListings.teamListUrl,
      tbaKey: eventListings.tbaKey,
      teamListParser: eventListings.teamListParser,
      teamListParserSourceUrl: eventListings.teamListParserSourceUrl,
      parserUpdatedAt: eventListings.teamListParserUpdatedAt,
      registeredTeamCount: eventListings.registeredTeamCount,
    })
    .from(eventListings)
    .where(eq(eventListings.id, listingId))
    .limit(1)
  if (!listing) return null

  const [snap] = await db
    .select()
    .from(eventRosterSnapshots)
    .where(eq(eventRosterSnapshots.eventListingId, listingId))
    .orderBy(desc(eventRosterSnapshots.fetchedAt))
    .limit(1)

  return {
    listingId: listing.id,
    name: listing.name,
    teamListUrl: listing.teamListUrl,
    tbaKey: listing.tbaKey,
    hasParser: Boolean(listing.teamListParser),
    parserSourceUrl: listing.teamListParserSourceUrl,
    parserUpdatedAt: listing.parserUpdatedAt,
    registeredTeamCount: listing.registeredTeamCount,
    snapshot: snap
      ? {
          id: snap.id,
          sourceUrl: snap.sourceUrl,
          fetchedAt: snap.fetchedAt,
          httpStatus: snap.httpStatus,
          teamCount: snap.teamCount,
          status: snap.status,
          changed: snap.changed,
          error: snap.error,
          teams: snap.teams ?? [],
        }
      : null,
  }
}
