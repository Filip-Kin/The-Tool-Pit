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
import { renderPage } from '../connectors/playwright-render.js'

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
  /** Rosters read off an event's own team-list page rather than from TBA. */
  fromSite: number
}

/**
 * Team numbers on an event's own team list page.
 *
 * TBA holds a roster once an event is CODED there, and plenty of off-season
 * events never are: they publish a team list on their own site and nowhere
 * else. That page is the only machine-readable record of who is coming.
 *
 * DELIBERATELY CAUTIOUS. Any page has numbers on it, so a handful of matches
 * proves nothing: a page has to yield at least eight distinct plausible team
 * numbers before this believes it is looking at a team list at all. A four
 * digit number that is the event's own season is dropped, because "2026"
 * appears on every one of these pages as a year far more often than as team
 * 2026, and being wrong in that direction costs a real team its place in the
 * list rather than adding a phantom.
 */
export function teamNumbersOnPage(text: string, seasonYear?: number | null): number[] {
  const found = new Set<number>()
  for (const match of text.matchAll(/\b(\d{1,5})\b/g)) {
    const n = Number(match[1])
    if (!Number.isInteger(n) || n < 1 || n > 99_999) continue
    if (seasonYear && n === seasonYear) continue
    // Nothing in FRC is numbered above about 10,000 yet, and a five digit
    // number on a web page is far more likely a postcode or an ID.
    if (n > 12_000) continue
    found.add(n)
  }
  return found.size >= 8 ? [...found].sort((a, b) => a - b) : []
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
  const stats: RosterRefreshStats = { considered: 0, changed: 0, unchanged: 0, empty: 0, failed: 0, fromSite: 0 }

  const apiKey = process.env.TBA_API_KEY
  if (!apiKey) {
    console.warn('[roster-refresh] TBA_API_KEY not set, nothing to do')
    return stats
  }

  const db = getDb()
  const listings = await db
    .select({
      id: eventListings.id,
      name: eventListings.name,
      tbaKey: eventListings.tbaKey,
      teamListUrl: eventListings.teamListUrl,
      seasonYear: eventListings.seasonYear,
    })
    .from(eventListings)

  // Pending listings included on purpose, so a moderator sees the count before
  // deciding whether to publish.
  const wanted = listings.filter(
    (l) => (l.tbaKey || l.teamListUrl) && (!payload.listingId || l.id === payload.listingId),
  )
  const withKey = wanted.filter((l) => l.tbaKey)
  const siteOnly = wanted.filter((l) => !l.tbaKey && l.teamListUrl)
  stats.considered = wanted.length

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

  // #region the event's own team list
  //
  // Only for listings TBA does not hold. TBA is structured and authoritative;
  // a page is neither, so its snapshot lands PENDING for review and the team
  // list stays out of public view until somebody has looked at it.
  //
  // The COUNT is promoted anyway, and that is a deliberate split: the number is
  // the same class of measurement TBA's is, it is the thing a team checks to
  // see whether there is still room, and it goes stale in a way a reviewer
  // cannot keep up with. The names are what needs a person.
  for (const listing of siteOnly) {
    const url = listing.teamListUrl as string
    try {
      const page = await renderPage(url)
      if (!page) {
        stats.failed++
        console.warn(`[roster-refresh] ${listing.name}: could not open ${url}`)
        continue
      }

      const numbers = teamNumbersOnPage(page.text, listing.seasonYear)
      if (numbers.length === 0) {
        stats.empty++
        console.log(`[roster-refresh] ${listing.name}: no team list found on ${url}`)
        continue
      }

      const teams: RosterTeam[] = numbers.map((number) => ({ number }))
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
        sourceUrl: url,
        httpStatus: 200,
        teamCount: teams.length,
        teams,
        contentHash: hash,
        changed: didChange,
        // Read off somebody's web page, so a person confirms the list.
        status: 'pending',
      })

      await db
        .update(eventListings)
        .set({ registeredTeamCount: teams.length, teamCountUpdatedAt: new Date(), updatedAt: new Date() })
        .where(eq(eventListings.id, listing.id))

      stats.fromSite++
      if (didChange) stats.changed++
      else stats.unchanged++
      console.log(`[roster-refresh] ${listing.name}: ${teams.length} teams from its own site`)
    } catch (err) {
      stats.failed++
      console.error(`[roster-refresh] ${listing.name} (${url}): ${String(err)}`)
    }
  }
  // #endregion

  console.log(
    `[roster-refresh] ${stats.considered} listings: ${stats.changed} changed, ${stats.unchanged} unchanged, ` +
      `${stats.fromSite} read off their own site, ${stats.empty} with no roster yet, ${stats.failed} failed`,
  )
  return stats
}
