/**
 * Keep each off-season event's registered team count current, from TBA.
 *
 * This was scripts/sync-event-rosters.ts, run by hand, which meant the count
 * was as fresh as the last time somebody remembered. It is the one number on
 * these listings that genuinely moves week to week, and a stale one is worse
 * than none: a team looking at "12 registered" on an event that filled up a
 * month ago plans around a place that is not there.
 *
 * MACHINE-OWNED COLUMNS ONLY, and the split is written down in
 * MACHINE_OWNED_EVENT_KEYS. This job may write registeredTeamCount and
 * teamCountUpdatedAt and nothing else on the listing. Everything an organiser
 * can type is theirs: they moved the event to a different gym and TBA has not
 * heard yet, so TBA is the one that is wrong.
 *
 * WHY TBA rather than each event's own site: off-season events register through
 * wildly different systems and their sites almost never publish a real roster
 * in static HTML. TBA holds it once an event is coded there, and it is the same
 * source the photos vertical already trusts.
 *
 * Deterministic. No model call.
 */
import { createHash } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { getDb, eventListings, eventRosterSnapshots, type RosterTeam } from '@the-tool-pit/db'
import { delay } from '../connectors/base.js'

const TBA_BASE = 'https://www.thebluealliance.com/api/v3'

export interface RosterRefreshPayload {
  /** Refresh one listing rather than every listing with a TBA key. */
  listingId?: string
}

export interface RosterRefreshStats {
  considered: number
  changed: number
  unchanged: number
  /** Coded in TBA but with no roster published yet. Their count is left alone. */
  empty: number
  failed: number
}

async function fetchRoster(
  tbaKey: string,
  apiKey: string,
): Promise<{ teams: RosterTeam[]; httpStatus: number }> {
  const res = await fetch(`${TBA_BASE}/event/${tbaKey}/teams/simple`, {
    headers: { 'X-TBA-Auth-Key': apiKey },
  })
  if (!res.ok) return { teams: [], httpStatus: res.status }
  const raw = (await res.json()) as Array<{ team_number: number; nickname: string | null }>
  const teams = raw
    .map((t) => ({ number: t.team_number, name: t.nickname ?? undefined }))
    .filter((t) => Number.isInteger(t.number))
    .sort((a, b) => a.number - b.number)
  return { teams, httpStatus: res.status }
}

/** Hash of the team numbers alone, so a nickname edit is not a roster change. */
function hashTeams(teams: RosterTeam[]): string {
  return createHash('sha256').update(teams.map((t) => t.number).join(',')).digest('hex')
}

export async function processRosterRefreshJob(
  payload: RosterRefreshPayload = {},
): Promise<RosterRefreshStats> {
  const stats: RosterRefreshStats = { considered: 0, changed: 0, unchanged: 0, empty: 0, failed: 0 }

  const apiKey = process.env.TBA_API_KEY
  if (!apiKey) {
    console.warn('[roster-refresh] TBA_API_KEY not set, nothing to do')
    return stats
  }

  const db = getDb()
  const listings = await db
    .select({ id: eventListings.id, name: eventListings.name, tbaKey: eventListings.tbaKey })
    .from(eventListings)

  // Pending listings included on purpose, so a moderator sees the count before
  // deciding whether to publish.
  const withKey = listings.filter(
    (l) => l.tbaKey && (!payload.listingId || l.id === payload.listingId),
  )
  stats.considered = withKey.length

  for (const listing of withKey) {
    const tbaKey = listing.tbaKey as string
    try {
      const { teams, httpStatus } = await fetchRoster(tbaKey, apiKey)
      const hash = hashTeams(teams)

      const [previous] = await db
        .select({ contentHash: eventRosterSnapshots.contentHash })
        .from(eventRosterSnapshots)
        .where(eq(eventRosterSnapshots.eventListingId, listing.id))
        .orderBy(desc(eventRosterSnapshots.fetchedAt))
        .limit(1)

      const didChange = previous?.contentHash !== hash

      await db.insert(eventRosterSnapshots).values({
        eventListingId: listing.id,
        sourceUrl: `${TBA_BASE}/event/${tbaKey}/teams/simple`,
        httpStatus,
        teamCount: teams.length,
        teams,
        contentHash: hash,
        changed: didChange,
        // TBA is authoritative, so its snapshots need no human review. A future
        // per-site scrape would land 'pending' instead.
        status: 'approved',
      })

      if (teams.length > 0) {
        await db
          .update(eventListings)
          .set({ registeredTeamCount: teams.length, teamCountUpdatedAt: new Date(), updatedAt: new Date() })
          .where(eq(eventListings.id, listing.id))
      } else {
        // An event TBA has not populated keeps whatever count it had rather
        // than being reset to zero, which would read as "nobody signed up".
        stats.empty++
      }

      if (didChange) {
        stats.changed++
        console.log(`[roster-refresh] ${listing.name} (${tbaKey}): ${teams.length} teams`)
      } else {
        stats.unchanged++
      }
    } catch (err) {
      stats.failed++
      console.error(`[roster-refresh] ${listing.name} (${tbaKey}): ${String(err)}`)
    }

    await delay(250)
  }

  console.log(
    `[roster-refresh] ${stats.considered} listings: ${stats.changed} changed, ${stats.unchanged} unchanged, ` +
      `${stats.empty} with no roster yet, ${stats.failed} failed`,
  )
  return stats
}
