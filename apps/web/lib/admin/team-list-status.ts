/**
 * The health of one event listing's team-list source, as a badge.
 *
 * A reviewer scanning the admin lists needs to see at a glance which events
 * have a working roster source and which are broken, without opening each row.
 * The rule mirrors how the worker actually sources a roster (see
 * apps/worker/src/listings/roster-refresh.ts):
 *
 *  - A TBA key means the count comes from The Blue Alliance. That is structured
 *    and authoritative, no scraping happens at all, so this is never "broken".
 *  - Otherwise, if the event has its own team-list page, a model-authored parser
 *    scrapes it. A stored parser (teamListParser) that yields a count is healthy;
 *    a null parser means the generator gave up or never ran; a parser that
 *    produces no teams, or whose last write is old, is stale.
 *  - No TBA key and no team-list page means there is no roster source to judge.
 *
 * Pure so the row and any list summary share one definition and it stays
 * unit-testable. Returns a semantic `tone` plus the Tailwind text-colour token
 * the codebase already uses, so callers never hardcode a colour.
 */

/** The team-list source health of a listing, most-broken-worth-noticing first. */
export type TeamListTone = 'tba' | 'ok' | 'failed' | 'stale' | 'none'

export interface TeamListStatus {
  /** One short line for the badge, e.g. "Scraping OK — 24 teams". */
  label: string
  /** Semantic health, for callers that group or count by state. */
  tone: TeamListTone
  /** The Tailwind text-colour class matching the tone (an existing token). */
  className: string
}

/** Tone -> the existing colour token the rest of the admin UI uses. */
export const TEAM_LIST_TONE_CLASS: Record<TeamListTone, string> = {
  tba: 'text-primary', // neutral/blue: count comes from TBA
  ok: 'text-rookie', // green: scraping works
  failed: 'text-frc', // red: no parser, scraping broken
  stale: 'text-stale', // amber: parser present but no fresh count
  none: 'text-muted-2', // grey: nothing to scrape
}

/**
 * How old a parser's last write may be before its scrape reads as stale.
 *
 * The refresh runs daily, so a parser that has not been touched in this long,
 * while its event still has no count, is one nobody has managed to get working
 * rather than one that is simply quiet.
 */
export const TEAM_LIST_STALE_DAYS = 21

/** The subset of a listing this indicator reads. */
export interface TeamListStatusInput {
  tbaKey: string | null
  teamListUrl: string | null
  teamListParser: string | null
  registeredTeamCount: number | null
  teamListParserUpdatedAt: Date | string | null
}

function isStale(updatedAt: Date | string | null, now: Date): boolean {
  if (!updatedAt) return true
  const t = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime()
  if (Number.isNaN(t)) return true
  return now.getTime() - t > TEAM_LIST_STALE_DAYS * 24 * 60 * 60 * 1000
}

export function teamListStatus(listing: TeamListStatusInput, now: Date = new Date()): TeamListStatus {
  const tone = (t: TeamListTone, label: string): TeamListStatus => ({ label, tone: t, className: TEAM_LIST_TONE_CLASS[t] })

  // A TBA key wins outright: the count is TBA's, scraping never runs.
  if (listing.tbaKey) return tone('tba', 'TBA')

  // No page means there is no scraping source to judge.
  if (!listing.teamListUrl) return tone('none', 'No team source')

  // A page but no parser: the generator gave up or never produced one.
  if (!listing.teamListParser) return tone('failed', 'Scraping failed')

  const count = listing.registeredTeamCount
  // A parser that yields a fresh, non-empty count is the healthy case.
  if (count != null && count > 0 && !isStale(listing.teamListParserUpdatedAt, now)) {
    return tone('ok', `Scraping OK — ${count} team${count === 1 ? '' : 's'}`)
  }

  // Parser present but the count is missing/zero, or the parser has gone
  // untouched too long. It ran once; it is not producing a roster now.
  return tone('stale', 'Scraping stale')
}
