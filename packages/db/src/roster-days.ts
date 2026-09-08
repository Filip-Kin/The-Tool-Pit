/**
 * One roster per day for a "2x 1-day" event, one roster for everything else.
 *
 * A listing flagged parallelDivisions (the column name is historical; it means
 * ONE event over two days where each day is its own 1-day tournament) keeps a
 * team list PER DAY: roster snapshots carry day 1 or 2. An ordinary listing's
 * snapshots carry null. The public roster, the count on the card and the
 * refresh job all read through here so they agree on what "latest" means.
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { eventRosterSnapshots, type RosterTeam } from './schema/event-listings'

// Any drizzle Postgres database; the query shapes below are the same on all.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, any, any>

export interface DayRoster {
  /** 1 or 2 for a two-1-day-events listing; null for an ordinary event. */
  day: number | null
  teams: RosterTeam[]
  contentHash: string | null
  fetchedAt: Date
}

/**
 * The latest APPROVED snapshot for each day the listing has one for, newest
 * first within a day. An ordinary event yields at most one entry (day null).
 * A two-day event may yield one, two, or (during a transition) a stray null
 * row too; callers that want days only filter on day != null.
 */
export async function latestApprovedRosters(db: Db, listingId: string): Promise<DayRoster[]> {
  const rows = await db
    .select({
      day: eventRosterSnapshots.day,
      teams: eventRosterSnapshots.teams,
      contentHash: eventRosterSnapshots.contentHash,
      fetchedAt: eventRosterSnapshots.fetchedAt,
    })
    .from(eventRosterSnapshots)
    .where(and(eq(eventRosterSnapshots.eventListingId, listingId), eq(eventRosterSnapshots.status, 'approved')))
    .orderBy(desc(eventRosterSnapshots.fetchedAt))
    .limit(50)
  const seen = new Set<string>()
  const out: DayRoster[] = []
  for (const r of rows) {
    const key = String(r.day ?? 'all')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ day: r.day ?? null, teams: (r.teams ?? []) as RosterTeam[], contentHash: r.contentHash, fetchedAt: r.fetchedAt })
  }
  return out.sort((a, b) => (a.day ?? 0) - (b.day ?? 0))
}

/** Same, but the newest snapshot of ANY reviewable status for one day (the refresh's baseline). */
export async function latestRosterForDay(
  db: Db,
  listingId: string,
  day: number | null,
  statuses: readonly string[] = ['approved', 'pending'],
): Promise<{ teams: RosterTeam[]; contentHash: string | null } | null> {
  const rows = await db
    .select({ day: eventRosterSnapshots.day, teams: eventRosterSnapshots.teams, contentHash: eventRosterSnapshots.contentHash })
    .from(eventRosterSnapshots)
    .where(and(eq(eventRosterSnapshots.eventListingId, listingId), inArray(eventRosterSnapshots.status, [...statuses])))
    .orderBy(desc(eventRosterSnapshots.fetchedAt))
    .limit(50)
  const hit = rows.find((r) => (r.day ?? null) === day)
  return hit ? { teams: (hit.teams ?? []) as RosterTeam[], contentHash: hit.contentHash } : null
}

/**
 * "Saturday, Sep 12" for a day of the event, from the listing's dates. Day 1
 * is startDate, day 2 is endDate (or startDate + 1 when endDate is missing).
 * Falls back to "Day N" when there are no dates to name.
 */
export function eventDayLabel(day: number, startDate: string | null | undefined, endDate: string | null | undefined): string {
  let iso: string | null = null
  if (day === 1) iso = startDate ?? null
  else if (day === 2) {
    if (endDate && endDate !== startDate) iso = endDate
    else if (startDate) {
      const d = new Date(`${startDate}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + 1)
      iso = d.toISOString().slice(0, 10)
    }
  }
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `Day ${day}`
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
