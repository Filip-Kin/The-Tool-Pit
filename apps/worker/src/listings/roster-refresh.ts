/**
 * Keep each off-season event's registered team count current.
 *
 * This was scripts/sync-event-rosters.ts, run by hand, which meant the count
 * was as fresh as the last time somebody remembered. It is the one number on
 * these listings that genuinely moves week to week, and a stale one is worse
 * than none: a team looking at "12 registered" on an event that filled up a
 * month ago plans around a place that is not there.
 *
 * TWO SOURCES, ONE RULE FOR PROMOTING THE COUNT. TBA is structured and
 * authoritative and writes its count immediately. An event's own team-list page
 * is scraped by a model-authored, self-proving parser (see team-list-parser.ts)
 * and USED to land as a pending snapshot a moderator had to approve by hand. It
 * no longer does: a scrape that reads cleanly and passes the suspect guard is
 * auto-approved and writes the public count too, exactly the way TBA does. Only
 * a scrape that looks wrong (leaked slot indices, an emptied roster, more than
 * half the teams gone, or a parser that will not run) is held: the bad run is
 * stored 'rejected', the last good count is kept, and a person is left to look.
 * There is an agent working the team-list script, so a clean parse is treated
 * as right rather than parked for a rubber-stamp.
 *
 * MACHINE-OWNED COLUMNS ONLY, and the split is written down in
 * MACHINE_OWNED_EVENT_KEYS. This job may write registeredTeamCount and
 * teamCountUpdatedAt and nothing else on the listing. Everything an organiser
 * can type is theirs: they moved the event to a different gym and TBA has not
 * heard yet, so TBA is the one that is wrong. registeredTeamCount is
 * machine-owned, so neither path needs a human-edited guard to write it.
 *
 * The TBA path is deterministic. The site path calls the model only to WRITE a
 * parser, once per event or when the page moves; the scheduled scrape after
 * that runs the stored parser with no model call.
 *
 * A THIRD MODE THIS JOB LEAVES ALONE. An owner can turn off scraping and type
 * their team list into the listing form instead (teamListMode 'manual'). That
 * roster is a trusted human entry the form publishes directly as an approved
 * snapshot, so this job SKIPS a manual listing entirely: it is never scraped and
 * its TBA key, if any, is never read over the top of what the owner typed.
 */
import { createHash } from 'node:crypto'
import { and, desc, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm'
import { getDb, eventListings, eventRosterSnapshots, isHumanEdited, getTeamNames, type RosterTeam } from '@the-tool-pit/db'
import { delay } from '../connectors/base.js'
import { TbaEventsConnector, type TbaEventUpsert } from '../connectors/tba-events.js'
import {
  generateTeamListParser,
  runTeamListParser,
  slotIndicesLeaked,
} from './team-list-parser.js'

const TBA_BASE = 'https://www.thebluealliance.com/api/v3'

export interface RosterRefreshPayload {
  /** Refresh one listing rather than every listing with a TBA key. */
  listingId?: string
  /**
   * Run the TBA re-check pass instead of a roster refresh: find a TBA key for
   * published listings that have none yet. Its own scheduled job in queues.ts.
   */
  recheckTba?: boolean
}

/** TBA event_type ints kept as off-season. 99 = OFFSEASON, 100 = PRESEASON. */
const OFFSEASON_EVENT_TYPES = new Set([99, 100])

/**
 * Where a listing's roster should be read from THIS run.
 *
 * TBA is not always the better source. An event's own team-list page is what an
 * organiser keeps current before the event runs, and it is often live weeks
 * before TBA has even coded the event. Once the event has started TBA becomes
 * authoritative: it holds the roster that actually turned up, deterministically
 * and without a per-site parser.
 *
 *   - Both sources, event not started yet -> the WEBSITE, even though a tbaKey
 *     exists, because the organiser's page is fresher pre-event.
 *   - Both sources, event started or over  -> TBA, now authoritative.
 *   - One source only                      -> that source.
 *   - No startDate                         -> treat as NOT started (most
 *     listings are upcoming), so the website wins when it exists.
 *
 * `today` is an ISO date (YYYY-MM-DD); startDate is the same shape, so a string
 * compare is a date compare.
 */
export function chooseRosterSource(
  listing: { tbaKey?: string | null; teamListUrl?: string | null; startDate?: string | null },
  today: string,
): 'tba' | 'site' | null {
  const hasTba = Boolean(listing.tbaKey)
  const hasUrl = Boolean(listing.teamListUrl)
  if (!hasTba && !hasUrl) return null
  if (hasTba && !hasUrl) return 'tba'
  if (hasUrl && !hasTba) return 'site'
  // Both exist: the website until the event starts, TBA once it has.
  const started = Boolean(listing.startDate) && today >= (listing.startDate as string)
  return started ? 'tba' : 'site'
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

export interface ScrapedRosterDecision {
  /** The snapshot status to store for this scrape. */
  status: 'approved' | 'rejected'
  /** Whether this run may write the public registeredTeamCount. */
  writeCount: boolean
  /** Why it was held, for the log and the stored snapshot. Null when approved. */
  reason: string | null
}

/**
 * The auto-approve rule for a site-scraped roster, in ONE place so it is
 * testable and the loop below cannot drift from it.
 *
 * A roster that passes the suspect guard is trusted the same way a TBA snapshot
 * is: stored 'approved', and its count written to the public listing. A roster
 * the guard flags (leaked slot indices, an emptied roster, or more than half the
 * previously-listed teams gone without being a superset) is held: stored
 * 'rejected', the last good count kept, nothing public. This is the whole of
 * "clean updates the count automatically; only a suspicious change waits for a
 * person".
 */
/**
 * Keep only numbers that are real FRC teams. A generated parser can pick a stray
 * number out of a section's prose (a count like "8 host teams", a date, a price)
 * and hand it back as a team. Every number is checked against the TBA team-name
 * cache; the 9970-9999 off-season / demo range is allowed too, since TBA issues
 * those. If the cache is empty (never synced), the roster is returned unchanged
 * rather than emptied.
 */
async function filterToKnownTeams(teams: RosterTeam[]): Promise<RosterTeam[]> {
  if (teams.length === 0) return teams
  const numbers = [...new Set(teams.map((t) => t.number))]
  const known = await getTeamNames(numbers)
  if (known.size === 0) return teams
  return teams.filter((t) => known.has(t.number) || (t.number >= 9970 && t.number <= 9999))
}

export function decideScrapedRoster(previous: RosterTeam[], next: RosterTeam[]): ScrapedRosterDecision {
  const suspect = suspectRosterChange(previous, next)
  if (suspect.suspect) return { status: 'rejected', writeCount: false, reason: suspect.reason }
  return { status: 'approved', writeCount: true, reason: null }
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

  // The daily TBA re-check pass is its own job on this same queue: find a key
  // for listings that have none, so a later run can read their roster.
  if (payload.recheckTba) {
    const r = await processTbaRecheck(db)
    stats.considered = r.considered
    stats.changed = r.matched
    stats.failed = r.failed
    console.log(
      `[roster-refresh] TBA re-check: ${r.considered} keyless listings, ${r.matched} newly keyed, ${r.failed} failed`,
    )
    return stats
  }

  const listings = await db
    .select({
      id: eventListings.id,
      name: eventListings.name,
      tbaKey: eventListings.tbaKey,
      teamListUrl: eventListings.teamListUrl,
      teamListMode: eventListings.teamListMode,
      startDate: eventListings.startDate,
      seasonYear: eventListings.seasonYear,
      teamListParser: eventListings.teamListParser,
      teamListParserSourceUrl: eventListings.teamListParserSourceUrl,
    })
    .from(eventListings)

  // Pending listings included on purpose, so a moderator sees the count before
  // deciding whether to publish. A listing whose owner entered the team list by
  // hand (teamListMode 'manual') is SKIPPED here: its roster is a trusted human
  // entry the owner form already published as an approved snapshot, and neither
  // a scrape nor a TBA read may overwrite it.
  const wanted = listings.filter(
    (l) =>
      l.teamListMode !== 'manual' &&
      (l.tbaKey || l.teamListUrl) &&
      (!payload.listingId || l.id === payload.listingId),
  )
  // Source per listing decided by timing, not by "does it have a key". A listing
  // with both a tbaKey and a teamListUrl reads from its own site until it starts
  // and from TBA after. See chooseRosterSource.
  const today = new Date().toISOString().slice(0, 10)
  const withKey = wanted.filter((l) => chooseRosterSource(l, today) === 'tba')
  const siteOnly = wanted.filter((l) => chooseRosterSource(l, today) === 'site')
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
  // For every listing chooseRosterSource routed here: one with no tbaKey at all,
  // and one that has a tbaKey but has not started yet, whose own page is the
  // fresher source until it does.
  //
  // AUTO-APPROVE when the roster reads cleanly. The parser proves itself before
  // it is ever stored, and the suspect guard (decideScrapedRoster over
  // suspectRosterChange: leak / emptied / >half-vanished non-superset) re-checks
  // every scheduled run. A read that passes is trusted the same way a TBA
  // snapshot is: the snapshot lands 'approved' and its count is written straight
  // to the public listing, no moderator in the loop. A moderator can still
  // approve a stray pending snapshot in the admin, but a clean scrape no longer
  // needs one.
  //
  // HELD only when the read looks wrong. If the stored parser leaks slot indices,
  // returns nothing against a known roster, or loses more than half the teams,
  // and a freshly generated parser cannot do better either, the bad run is stored
  // 'rejected', the last good count is kept, and nothing reaches the public card.
  // A parser that fails ten generation attempts pings Discord from
  // generateTeamListParser. So a clean roster updates the count automatically;
  // only a suspicious change waits for a person.
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

      // Only real FRC teams survive: the generated parser can pick a stray
      // number out of prose (a count like "8 host teams", a date, a price), so
      // every number is validated against the TBA team cache before it is stored.
      teams = await filterToKnownTeams(teams)

      // A sane roster. registeredTeamCount counts the teams IN the event, not
      // the waitlist below it, so a full event does not read as over capacity.
      // This is the count the auto-approve below writes to the public listing.
      const registeredCount = teams.filter((t) => !t.waitlisted).length
      const hash = hashTeams(teams)
      const didChange = previousSnap?.contentHash !== hash

      // Reaching here means the run already passed the suspect guard, so the
      // decision is 'approved'. Derived through decideScrapedRoster anyway, so
      // the stored status and the count-write can never drift from the rule.
      const decision = decideScrapedRoster(previousTeams, teams)

      await db.insert(eventRosterSnapshots).values({
        eventListingId: listing.id,
        sourceUrl: url,
        httpStatus: 200,
        teamCount: teams.length,
        teams,
        contentHash: hash,
        changed: didChange,
        // Clean scrape: trusted like TBA and auto-approved. The public count is
        // written below, so the snapshot and the listing agree in one pass.
        status: decision.status,
      })

      // Write the public count exactly as the TBA path and approveRosterSnapshot
      // do. registeredTeamCount is machine-owned (MACHINE_OWNED_EVENT_KEYS), so
      // it needs no human-edited guard. An empty clean roster keeps whatever
      // count it had rather than resetting the card to zero.
      if (decision.writeCount && teams.length > 0) {
        await db
          .update(eventListings)
          .set({ registeredTeamCount: registeredCount, teamCountUpdatedAt: new Date(), updatedAt: new Date() })
          .where(eq(eventListings.id, listing.id))
      } else if (teams.length === 0) {
        stats.empty++
      }

      stats.fromSite++
      if (didChange) stats.changed++
      else stats.unchanged++
      console.log(`[roster-refresh] ${listing.name}: ${registeredCount} teams via ${via} (auto-approved)`)
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

// #region TBA re-check for keyless listings

/** Name reduced to letters and digits, so punctuation and spacing do not decide a match. */
function normEventName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * A CONFIDENT TBA event for a listing that has no key, or null.
 *
 * Deliberately strict: a name that reduces to the same letters AND a second
 * signal that agrees (the exact start date, or the same city and region).
 * Attaching the wrong key would pull a different event's roster onto the
 * listing, which is worse than leaving it keyless for another day.
 */
export function findTbaMatch(
  listing: { name: string; startDate?: string | null; city?: string | null; region?: string | null },
  events: TbaEventUpsert[],
): { tbaKey: string; reason: string } | null {
  const target = normEventName(listing.name)
  // Too short to be distinctive: "CORI" or "MARC" alone would match loosely.
  if (target.length < 5) return null
  for (const ev of events) {
    if (normEventName(ev.name) !== target) continue
    if (listing.startDate && ev.startDate && listing.startDate === ev.startDate) {
      return { tbaKey: ev.tbaKey, reason: 'name + start date' }
    }
    if (
      listing.region &&
      ev.stateProv &&
      listing.city &&
      ev.city &&
      listing.region.toUpperCase() === ev.stateProv.toUpperCase() &&
      normEventName(listing.city) === normEventName(ev.city)
    ) {
      return { tbaKey: ev.tbaKey, reason: 'name + city/region' }
    }
  }
  return null
}

/**
 * Attach a TBA key to published listings that have none.
 *
 * Off-season events are often coded in TBA only a few days before they run, so
 * a listing we found first on Chief Delphi sits keyless until then. This pass
 * re-checks TBA for a confident match and writes the key, which lets the normal
 * roster refresh (and, once the event starts, its authoritative TBA roster)
 * take over. It NEVER overwrites a human-set key, and it never takes a key that
 * already belongs to another listing (tbaKey is unique).
 */
async function processTbaRecheck(
  db: ReturnType<typeof getDb>,
): Promise<{ considered: number; matched: number; failed: number }> {
  // Upcoming or recently finished. A key that appears after the event is still
  // worth having for its final roster; something that ran months ago is not.
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

  const keyless = await db
    .select({
      id: eventListings.id,
      name: eventListings.name,
      startDate: eventListings.startDate,
      seasonYear: eventListings.seasonYear,
      city: eventListings.city,
      region: eventListings.region,
      humanEditedFields: eventListings.humanEditedFields,
    })
    .from(eventListings)
    .where(
      and(
        eq(eventListings.status, 'published'),
        isNull(eventListings.tbaKey),
        // A manual listing is not ours to key: its roster is the owner's, and a
        // TBA key would only invite a later read over the top of what they typed.
        ne(eventListings.teamListMode, 'manual'),
        or(isNull(eventListings.startDate), gte(eventListings.startDate, cutoff)),
      ),
    )

  if (keyless.length === 0) return { considered: 0, matched: 0, failed: 0 }

  const currentYear = new Date().getFullYear()
  const years = new Set<number>([currentYear, currentYear + 1])
  for (const l of keyless) {
    if (l.seasonYear) years.add(l.seasonYear)
    else if (l.startDate) years.add(Number(l.startDate.slice(0, 4)))
  }

  // One TBA request per season, reusing the same client the discovery connector
  // uses. skipTeams: we only want the event list, not four hundred rosters.
  const connector = new TbaEventsConnector()
  const offseasonByYear = new Map<number, TbaEventUpsert[]>()
  for (const year of years) {
    try {
      const res = await connector.run(year, { skipTeams: true })
      offseasonByYear.set(
        year,
        res.events.filter((e) => e.eventType != null && OFFSEASON_EVENT_TYPES.has(e.eventType)),
      )
    } catch (err) {
      console.error(`[roster-recheck] TBA fetch ${year}: ${String(err)}`)
    }
    await delay(250)
  }

  let matched = 0
  let failed = 0
  for (const l of keyless) {
    // A key a person deliberately set (or cleared) is theirs; never touch it.
    if (isHumanEdited(l.humanEditedFields, 'tbaKey')) continue

    const year = l.seasonYear ?? (l.startDate ? Number(l.startDate.slice(0, 4)) : currentYear)
    const events = offseasonByYear.get(year) ?? []
    const match = findTbaMatch(l, events)
    if (!match) continue

    // tbaKey is unique. If the key already sits on another listing, this is a
    // duplicate of it, not a new key to write. Leave it for a human to merge.
    const [taken] = await db
      .select({ id: eventListings.id })
      .from(eventListings)
      .where(eq(eventListings.tbaKey, match.tbaKey))
      .limit(1)
    if (taken) {
      console.log(`[roster-recheck] ${l.name}: TBA ${match.tbaKey} already on another listing; left keyless`)
      continue
    }

    try {
      await db
        .update(eventListings)
        // Guard the write too: only if the key is still null, so two overlapping
        // passes cannot both claim it.
        .set({ tbaKey: match.tbaKey, updatedAt: new Date() })
        .where(and(eq(eventListings.id, l.id), isNull(eventListings.tbaKey)))
      matched++
      console.log(`[roster-recheck] ${l.name}: attached TBA key ${match.tbaKey} (${match.reason})`)
    } catch (err) {
      failed++
      console.error(`[roster-recheck] ${l.name}: ${String(err)}`)
    }
  }

  return { considered: keyless.length, matched, failed }
}

// #endregion
