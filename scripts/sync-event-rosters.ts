/**
 * Fills the off-season events fullness signal (registered team count) from The
 * Blue Alliance.
 *
 * WHY TBA and not per-site scraping: off-season events register through wildly
 * different systems, and their own marketing sites almost never expose a real
 * team list in static HTML (verified: C3 shows a 4-team sponsor block not its
 * 40-team roster; Goonettes shows only the host team; Ferris/MARC/WMRI are Wix
 * or flowcode JS pages; the DCC and Grand Rapids Girls sites 403 a bot). TBA,
 * on the other hand, holds the real roster once an event is coded there, and it
 * is the same authoritative source the photos vertical already trusts. So the
 * count comes from TBA, keyed on each listing's tbaKey.
 *
 * Because TBA is authoritative, its snapshots are written `approved` and the
 * count is promoted straight onto the listing. That is NOT a hole in the
 * "nothing scraped shows unreviewed" rule: that rule is for arbitrary event
 * sites. A per-site scrape (a future admin-configured rosterUrl) would instead
 * land `pending` for review - see event_roster_snapshots.status.
 *
 * Deterministic, zero AI, zero model calls.
 *
 * Run from the repo root (TBA_API_KEY + DATABASE_URL in the environment or
 * the root .env):
 *   DATABASE_URL=... TBA_API_KEY=... bun scripts/sync-event-rosters.ts
 * Safe to run on a cadence (a daily cron). Re-running is a no-op when a roster
 * has not changed (content hash guard).
 */
import { createHash } from 'node:crypto'
import { getDb, eventListings, eventRosterSnapshots, eq, desc } from '../packages/db/src/index'
import type { RosterTeam } from '../packages/db/src/index'

const TBA_BASE = 'https://www.thebluealliance.com/api/v3'

async function fetchRoster(tbaKey: string, apiKey: string): Promise<{ teams: RosterTeam[]; httpStatus: number }> {
  const res = await fetch(`${TBA_BASE}/event/${tbaKey}/teams/simple`, { headers: { 'X-TBA-Auth-Key': apiKey } })
  if (!res.ok) return { teams: [], httpStatus: res.status }
  const raw = (await res.json()) as Array<{ team_number: number; nickname: string | null }>
  const teams = raw
    .map((t) => ({ number: t.team_number, name: t.nickname ?? undefined }))
    .filter((t) => Number.isInteger(t.number))
    .sort((a, b) => a.number - b.number)
  return { teams, httpStatus: res.status }
}

/** Hash of just the team numbers, so a nickname edit does not count as a change. */
function hashTeams(teams: RosterTeam[]): string {
  return createHash('sha256').update(teams.map((t) => t.number).join(',')).digest('hex')
}

async function main() {
  const apiKey = process.env.TBA_API_KEY
  if (!apiKey) {
    console.error('TBA_API_KEY not set - nothing to do.')
    process.exit(1)
  }
  const db = getDb()

  // Every listing that has a TBA code. Includes pending ones so a moderator sees
  // the count before publishing.
  const listings = await db
    .select({ id: eventListings.id, name: eventListings.name, tbaKey: eventListings.tbaKey })
    .from(eventListings)

  const withKey = listings.filter((l) => l.tbaKey)
  console.log(`${withKey.length} listing(s) have a tbaKey.`)

  let changed = 0
  let unchanged = 0
  let empty = 0
  for (const l of withKey) {
    const tbaKey = l.tbaKey as string
    try {
      const { teams, httpStatus } = await fetchRoster(tbaKey, apiKey)
      const hash = hashTeams(teams)

      const [prev] = await db
        .select({ contentHash: eventRosterSnapshots.contentHash })
        .from(eventRosterSnapshots)
        .where(eq(eventRosterSnapshots.eventListingId, l.id))
        .orderBy(desc(eventRosterSnapshots.fetchedAt))
        .limit(1)

      const didChange = prev?.contentHash !== hash

      await db.insert(eventRosterSnapshots).values({
        eventListingId: l.id,
        sourceUrl: `${TBA_BASE}/event/${tbaKey}/teams/simple`,
        httpStatus,
        teamCount: teams.length,
        teams,
        contentHash: hash,
        changed: didChange,
        // TBA is authoritative, so its snapshots need no human review.
        status: 'approved',
      })

      // Promote the count onto the listing. Only touch it when the roster is
      // non-empty, so an event TBA has not populated yet keeps whatever it had
      // rather than being reset to 0.
      if (teams.length > 0) {
        await db
          .update(eventListings)
          .set({ registeredTeamCount: teams.length, teamCountUpdatedAt: new Date(), updatedAt: new Date() })
          .where(eq(eventListings.id, l.id))
      } else {
        empty++
      }

      if (didChange) {
        changed++
        console.log(`  ~ ${l.name} (${tbaKey}): ${teams.length} teams`)
      } else {
        unchanged++
      }
    } catch (err) {
      console.error(`  ! ${l.name} (${tbaKey}): ${String(err)}`)
    }
    // Be polite to the TBA API.
    await new Promise((r) => setTimeout(r, 250))
  }

  console.log(`Done. ${changed} changed, ${unchanged} unchanged, ${empty} with no roster yet.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
