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
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb, eventListings, eventRosterSnapshots, type RosterTeam } from '@the-tool-pit/db'
import { delay } from '../connectors/base.js'
import {
  generateTeamListParser,
  runTeamListParser,
  slotIndicesLeaked,
} from './team-list-parser.js'

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

/**
 * Whether a stored parser's fresh output reads as garbage rather than a roster.
 *
 * A stored parser breaks silently when the event redesigns its site, and the
 * tell the owner named is the roster turning to nonsense: [503, 247, 8728, 226]
 * becoming [1, 2, 3, 4]. Three signals catch that deterministically.
 *
 *  (a) The numbers are a slot or row column (1, 2, 3, ...), not team numbers.
 *  (b) The parser returned nothing while the last known roster was not empty.
 *  (c) Most of the previously listed teams are gone at once.
 *
 * A roster GROWS as registration fills, so a list that keeps every old team and
 * adds more is healthy however large it got: a superset is never suspect. The
 * bad case is the other direction, old teams vanishing, which is what a broken
 * selector or a leaked slot column looks like.
 */
/** Record the newly written parser and the URL it was written against. */
async function storeParser(
  db: ReturnType<typeof getDb>,
  listingId: string,
  script: string,
  url: string,
): Promise<void> {
  await db
    .update(eventListings)
    .set({
      teamListParser: script,
      teamListParserSourceUrl: url,
      teamListParserUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(eventListings.id, listingId))
}

export function suspectRosterChange(
  previous: RosterTeam[],
  next: RosterTeam[],
): { suspect: boolean; reason: string | null } {
  const leak = slotIndicesLeaked(next)
  if (leak) return { suspect: true, reason: `the result is slot indices (${leak}), not team numbers` }
  if (previous.length > 0 && next.length === 0)
    return { suspect: true, reason: 'the parser returned nothing but the last roster was not empty' }
  if (previous.length === 0) return { suspect: false, reason: null }

  const prevNums = new Set(previous.map((t) => t.number))
  const nextNums = new Set(next.map((t) => t.number))
  let stillPresent = 0
  for (const n of prevNums) if (nextNums.has(n)) stillPresent++
  // Every old team still there: a healthy roster, grown or unchanged.
  if (stillPresent === prevNums.size) return { suspect: false, reason: null }
  // Fewer than half of the known teams survived. That is the garbage case.
  if (stillPresent * 2 < prevNums.size)
    return { suspect: true, reason: `only ${stillPresent} of ${prevNums.size} previously listed teams remain` }
  return { suspect: false, reason: null }
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
      teamListParser: eventListings.teamListParser,
      teamListParserSourceUrl: eventListings.teamListParserSourceUrl,
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
  //
  // A MODEL-AUTHORED PARSER, not a shared heuristic. Every event's list is
  // shaped differently and no regex reads them all: RiverRage writes the team
  // number then a name, CORI and MARC write a SLOT index, a dash, the team
  // number, with blank slots and "4145 B" second robots. The old
  // teamNumbersOnPage counted every number on the page, so it read slot indices
  // as teams. Instead the model writes one parser per event once, we prove it,
  // and it runs deterministically after that with no model call. See
  // listings/team-list-parser.ts.
  for (const listing of siteOnly) {
    const url = listing.teamListUrl as string
    try {
      // The roster last known to be real: the newest non-empty snapshot that is
      // approved or pending review. A garbage run is stored REJECTED, so it can
      // never become the baseline the suspect guard compares against.
      const [previousSnap] = await db
        .select({ teams: eventRosterSnapshots.teams, contentHash: eventRosterSnapshots.contentHash })
        .from(eventRosterSnapshots)
        .where(
          and(
            eq(eventRosterSnapshots.eventListingId, listing.id),
            inArray(eventRosterSnapshots.status, ['approved', 'pending']),
          ),
        )
        .orderBy(desc(eventRosterSnapshots.fetchedAt))
        .limit(1)
      const previousTeams = (previousSnap?.teams ?? []) as RosterTeam[]

      const hasParser = Boolean(listing.teamListParser)
      // A changed teamListUrl means a changed page. A parser written for the old
      // URL is not trusted on a page it never saw; it is rewritten instead.
      const urlChanged = listing.teamListParserSourceUrl !== url

      let teams: RosterTeam[] | null = null
      let via: string

      if (!hasParser || urlChanged) {
        // No parser, or the page moved. Write one and prove it before trusting
        // it; generate retries ten times and pings Discord on total failure.
        const gen = await generateTeamListParser({ eventName: listing.name, url })
        if (!gen) {
          stats.failed++
          console.warn(`[roster-refresh] ${listing.name}: could not generate a parser for ${url}`)
          continue
        }
        await storeParser(db, listing.id, gen.script, url)
        teams = gen.teams
        via = hasParser ? 'parser regenerated (page moved)' : 'parser generated'
      } else {
        // Run the stored parser with no model call.
        const run = await runTeamListParser(url, listing.teamListParser as string)
        const ran = run.ok ? run.teams : []
        const suspect = run.ok
          ? suspectRosterChange(previousTeams, ran)
          : { suspect: true, reason: run.error }

        if (!suspect.suspect) {
          teams = ran
          via = 'stored parser'
        } else {
          // The stored parser looks broken. Rewrite it and try the fresh one.
          console.warn(`[roster-refresh] ${listing.name}: stored parser SUSPECT (${suspect.reason}); regenerating`)
          const gen = await generateTeamListParser({ eventName: listing.name, url })
          const fresh = gen?.teams ?? []
          const freshSuspect = gen
            ? suspectRosterChange(previousTeams, fresh)
            : { suspect: true, reason: 'generation failed' }

          if (gen && !freshSuspect.suspect) {
            await storeParser(db, listing.id, gen.script, url)
            teams = fresh
            via = 'parser regenerated (was suspect)'
          } else {
            // Neither the stored nor a fresh parser gave a sane roster. Never
            // overwrite a real count with garbage: keep the last good count and
            // store the bad run REJECTED so it cannot become the next baseline.
            const badTeams = gen ? fresh : ran
            await db.insert(eventRosterSnapshots).values({
              eventListingId: listing.id,
              sourceUrl: url,
              httpStatus: 200,
              teamCount: badTeams.length,
              teams: badTeams,
              contentHash: hashTeams(badTeams),
              changed: false,
              status: 'rejected',
              error: `suspect roster kept out: ${freshSuspect.reason ?? suspect.reason}`,
            })
            stats.failed++
            console.warn(
              `[roster-refresh] ${listing.name}: kept last good count; a fresh parser was still suspect (${freshSuspect.reason ?? suspect.reason})`,
            )
            continue
          }
        }
      }

      // A sane roster. registeredTeamCount counts the teams IN the event, not
      // the waitlist below it, so a full event does not read as over capacity.
      const registeredCount = teams.filter((t) => !t.waitlisted).length
      const hash = hashTeams(teams)
      const didChange = previousSnap?.contentHash !== hash

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
        .set({ registeredTeamCount: registeredCount, teamCountUpdatedAt: new Date(), updatedAt: new Date() })
        .where(eq(eventListings.id, listing.id))

      stats.fromSite++
      if (didChange) stats.changed++
      else stats.unchanged++
      console.log(`[roster-refresh] ${listing.name}: ${registeredCount} teams via ${via}`)
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
