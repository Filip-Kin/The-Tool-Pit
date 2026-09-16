/**
 * Push each opted-in listing's roster to The Blue Alliance's trusted API.
 *
 * The reverse of roster-refresh.ts: that job reads TBA (or an event's own
 * site) INTO our roster; this one writes OUR roster (manual or scraped, it
 * does not care which — both land in event_roster_snapshots the same way)
 * OUT to TBA's event page, for listings whose owner opted in and gave us a
 * TBA trusted-API auth_id/auth_secret (event_tba_credentials).
 *
 * ONLY UNTIL THE EVENT STARTS. Once an event is running, TBA holds the roster
 * that actually turned up and is the authoritative source (same rule
 * roster-refresh already applies when reading); pushing a stale manual/scraped
 * list over that would make things worse, not better. Day 1's gate is
 * startDate; day 2's is endDate, the same split eventDayLabel and
 * roster-refresh already use for a parallelDivisions ("2x 1-day") listing.
 */
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { latestApprovedRosters } from '@the-tool-pit/db/roster-days'
import { getDb, eventListings, eventTbaCredentials, type RosterTeam } from '@the-tool-pit/db'
import { pushTeamList, type TbaTrustedCredentials } from '../connectors/tba-trusted.js'
import { delay } from '../connectors/base.js'

export interface TbaPushPayload {
  /** Push one listing rather than every opted-in listing. */
  listingId?: string
}

export interface TbaPushStats {
  considered: number
  pushed: number
  unchanged: number
  skippedStarted: number
  failed: number
}

/** Hash of the team numbers alone (same idea as roster-refresh's hashTeams), so an unchanged roster is not re-sent every run. */
function hashNumbers(teams: RosterTeam[]): string {
  return createHash('sha256')
    .update(
      teams
        .map((t) => t.number)
        .sort((a, b) => a - b)
        .join(','),
    )
    .digest('hex')
}

export async function processTbaPushJob(payload: TbaPushPayload = {}): Promise<TbaPushStats> {
  const stats: TbaPushStats = { considered: 0, pushed: 0, unchanged: 0, skippedStarted: 0, failed: 0 }
  const db = getDb()

  const rows = await db
    .select({
      id: eventListings.id,
      name: eventListings.name,
      tbaKey: eventListings.tbaKey,
      tbaKeyDay2: eventListings.tbaKeyDay2,
      parallelDivisions: eventListings.parallelDivisions,
      startDate: eventListings.startDate,
      endDate: eventListings.endDate,
      tbaPushedHash: eventListings.tbaPushedHash,
      tbaPushedHashDay2: eventListings.tbaPushedHashDay2,
      authId: eventTbaCredentials.authId,
      authSecret: eventTbaCredentials.authSecret,
    })
    .from(eventListings)
    .innerJoin(eventTbaCredentials, eq(eventTbaCredentials.eventListingId, eventListings.id))
    .where(eq(eventListings.tbaAutoPush, true))

  const listings = rows.filter((l) => !payload.listingId || l.id === payload.listingId)
  const today = new Date().toISOString().slice(0, 10)
  const started = (date: string | null | undefined) => Boolean(date) && today >= (date as string)

  for (const listing of listings) {
    stats.considered++
    if (!listing.tbaKey && !listing.tbaKeyDay2) continue

    const creds: TbaTrustedCredentials = { authId: listing.authId, authSecret: listing.authSecret }
    const rosters = await latestApprovedRosters(db, listing.id)

    const units: Array<{ day: number | null; tbaKey: string; gateDate: string | null | undefined }> = listing.parallelDivisions
      ? [
          ...(listing.tbaKey ? [{ day: 1, tbaKey: listing.tbaKey, gateDate: listing.startDate }] : []),
          ...(listing.tbaKeyDay2 ? [{ day: 2, tbaKey: listing.tbaKeyDay2, gateDate: listing.endDate }] : []),
        ]
      : [{ day: null, tbaKey: listing.tbaKey as string, gateDate: listing.startDate }]

    for (const unit of units) {
      const tag = unit.day ? `${unit.tbaKey}, day ${unit.day}` : unit.tbaKey

      if (started(unit.gateDate)) {
        stats.skippedStarted++
        await db
          .update(eventListings)
          .set({ tbaPushStatus: 'skipped_started', tbaPushError: null, updatedAt: new Date() })
          .where(eq(eventListings.id, listing.id))
        continue
      }

      const roster = rosters.find((r) => r.day === unit.day)
      if (!roster || roster.teams.length === 0) continue

      const hash = hashNumbers(roster.teams)
      const lastHash = unit.day === 2 ? listing.tbaPushedHashDay2 : listing.tbaPushedHash
      if (hash === lastHash) {
        stats.unchanged++
        continue
      }

      const hashPatch = unit.day === 2 ? { tbaPushedHashDay2: hash } : { tbaPushedHash: hash }
      try {
        const result = await pushTeamList(unit.tbaKey, creds, roster.teams.map((t) => t.number))
        if (result.ok) {
          stats.pushed++
          await db
            .update(eventListings)
            .set({ ...hashPatch, tbaPushedAt: new Date(), tbaPushStatus: 'ok', tbaPushError: null, updatedAt: new Date() })
            .where(eq(eventListings.id, listing.id))
          console.log(`[tba-push] ${listing.name} (${tag}): pushed ${roster.teams.length} teams`)
        } else {
          stats.failed++
          await db
            .update(eventListings)
            .set({ tbaPushStatus: 'error', tbaPushError: `HTTP ${result.httpStatus}: ${result.message}`.slice(0, 500), updatedAt: new Date() })
            .where(eq(eventListings.id, listing.id))
          console.error(`[tba-push] ${listing.name} (${tag}): HTTP ${result.httpStatus} ${result.message}`)
        }
      } catch (err) {
        stats.failed++
        await db
          .update(eventListings)
          .set({ tbaPushStatus: 'error', tbaPushError: String(err).slice(0, 500), updatedAt: new Date() })
          .where(eq(eventListings.id, listing.id))
        console.error(`[tba-push] ${listing.name} (${tag}): ${String(err)}`)
      }
      await delay(250)
    }
  }

  return stats
}
