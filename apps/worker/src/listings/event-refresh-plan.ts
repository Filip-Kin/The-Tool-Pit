/**
 * What the weekly refresh may change on a published event, decided without
 * touching the database, the network or the model.
 *
 * THE GAP. A published event was read once, when it came in, and then only
 * ever filled (enrich-listing.ts writes a column that is blank and never one
 * that holds a value). An organiser who moved the event to another gym, closed
 * registration, or put up a team list page after publishing left the listing
 * saying the old thing until somebody noticed. Grants have had a monitor that
 * re-reads and applies proven changes for months; events had nothing.
 *
 * THE RULE. A value the reader returns that differs from the listing is
 * applied when, and only when, it is PROVEN: its quote (or, for a link, the
 * link itself) is in the text that was actually fetched this run. The quote is
 * the proof, so a large change applies as readily as a small one: a start date
 * moved three months, a sign-up form that moved to a different host. There is
 * no human queue; whatever is not applied is logged and the next weekly run
 * reads again.
 *
 * NEVER APPLIED, whatever the quote says:
 *   - a field a person claimed (human_edited_fields). Theirs, permanently.
 *   - clearing a value. "The page does not say" is not "the page says none",
 *     and a reader that missed a section must not wipe what was there.
 *     registrationStatus / volunteerStatus going back to 'unknown' is a clear.
 *   - a date that is already past. On a site that keeps every year's pages up
 *     that is nearly always last year's edition read by mistake.
 *   - an event date order that would end before it starts.
 *   - eventStatus to cancelled or completed. Cancellation belongs to the
 *     status watch, which dedupes on its quote so a person's revert stands;
 *     completed is derived from the date.
 *   - a text field the reader merely REWORDED: the old venue name still on the
 *     page while the reader wrote it shorter is the same venue, not a move.
 *     Without this every free-text field would churn on every read.
 */
import { isHumanEdited, offseasonSeasonYear, type ExtractedEventListingFields } from '@the-tool-pit/db'
import { normaliseForQuoteMatch, quoteSource, urlSource, type NamedText } from '../model/evidence.js'

// #region keys

/** Which extracted fields may fill a blank listing column, or refresh a set one. The pin and tbaKey are handled apart. */
export const FILLABLE = [
  'venueName', 'address', 'city', 'region', 'country', 'hostTeamNumber',
  'startDate', 'endDate', 'days', 'capacity', 'costUsd', 'costNote',
  'eventStatus', 'registrationStatus', 'registrationOpensAt', 'registrationClosesAt', 'volunteerStatus', 'registrationUrl', 'volunteerUrl',
  'website', 'teamListUrl', 'contactEmail', 'notes',
] as const satisfies readonly (keyof ExtractedEventListingFields)[]

/** Everything the weekly refresh compares: the fillable fields, and the name. */
export const REFRESH_KEYS = ['name', ...FILLABLE] as const
export type RefreshKey = (typeof REFRESH_KEYS)[number]

/**
 * Short field labels for the Discord alert, the same words as
 * apps/web/lib/events/event-edit-diff.ts EVENT_EDIT_KEY_LABELS. A copy rather
 * than an import because the worker does not depend on the web app.
 */
export const REFRESH_FIELD_LABELS: Record<RefreshKey, string> = {
  name: 'Name',
  venueName: 'Venue',
  address: 'Address',
  city: 'City',
  region: 'State',
  country: 'Country',
  hostTeamNumber: 'Host team',
  startDate: 'First day',
  endDate: 'Last day',
  days: 'Competition days',
  capacity: 'Capacity',
  costUsd: 'Cost (USD)',
  costNote: 'Cost note',
  eventStatus: 'Event status',
  registrationStatus: 'Registration',
  registrationOpensAt: 'Registration opens',
  registrationClosesAt: 'Registration closes',
  volunteerStatus: 'Volunteers',
  registrationUrl: 'Sign-up link',
  volunteerUrl: 'Volunteer link',
  website: 'Website',
  teamListUrl: 'Team list page',
  contactEmail: 'Contact email',
  notes: 'Notes',
}

const URL_KEYS = new Set<RefreshKey>(['registrationUrl', 'volunteerUrl', 'website', 'teamListUrl'])
const DATE_KEYS = new Set<RefreshKey>(['startDate', 'endDate', 'registrationOpensAt', 'registrationClosesAt'])
const NUMBER_KEYS = new Set<RefreshKey>(['hostTeamNumber', 'days', 'capacity', 'costUsd'])
const STATUS_KEYS = new Set<RefreshKey>(['registrationStatus', 'volunteerStatus'])
/** Free text where a reworded read of the same thing must not count as a change. */
const REWORDABLE_KEYS = new Set<RefreshKey>(['name', 'venueName', 'address', 'costNote', 'notes'])
/** A change to any of these moves the pin. */
const PLACE_KEYS = new Set<RefreshKey>(['venueName', 'address', 'city', 'region', 'country'])
/** A change to any of these changes which roster is read, or when. */
const ROSTER_KEYS = new Set<RefreshKey>(['startDate', 'endDate', 'teamListUrl'])

// #endregion

// #region comparing

function bareUrl(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

const COUNTRY_ALIASES: Record<string, string> = {
  us: 'US', usa: 'US', 'united states': 'US', 'united states of america': 'US',
  ca: 'CA', canada: 'CA', mx: 'MX', mexico: 'MX', au: 'AU', australia: 'AU',
  il: 'IL', israel: 'IL', tr: 'TR', turkey: 'TR', turkiye: 'TR', cn: 'CN', china: 'CN',
}

/** "United States", "USA" and "US" are one country. */
export function countryCode(value: string): string {
  const k = value.trim().toLowerCase().replace(/\./g, '')
  return COUNTRY_ALIASES[k] ?? k.toUpperCase()
}

const STREET_ABBR: Array<[RegExp, string]> = [
  [/\bsoutheast\b/g, 'se'], [/\bsouthwest\b/g, 'sw'], [/\bnortheast\b/g, 'ne'], [/\bnorthwest\b/g, 'nw'],
  [/\bnorth\b/g, 'n'], [/\bsouth\b/g, 's'], [/\beast\b/g, 'e'], [/\bwest\b/g, 'w'],
  [/\bstreet\b/g, 'st'], [/\bavenue\b/g, 'ave'], [/\broad\b/g, 'rd'], [/\bdrive\b/g, 'dr'],
  [/\bboulevard\b/g, 'blvd'], [/\bhighway\b/g, 'hwy'], [/\blane\b/g, 'ln'], [/\bparkway\b/g, 'pkwy'],
  [/\bcourt\b/g, 'ct'], [/\bplace\b/g, 'pl'], [/\bcircle\b/g, 'cir'],
]

/**
 * The street line only, abbreviations folded: "23499 Southeast Tahoma Way"
 * and "23499 SE Tahoma Way, Maple Valley, Washington, 98038" are one address.
 * City, state and zip have their own columns.
 */
export function streetKey(value: string): string {
  let v = value.split(/[,\n]/)[0].toLowerCase().replace(/[.#]/g, ' ')
  for (const [re, to] of STREET_ABBR) v = v.replace(re, to)
  return v.replace(/\s+/g, ' ').trim()
}

/** Event notes are written by the owner or a reviewer, never re-read from a page. */
export const NEVER_REFRESHED: ReadonlySet<string> = new Set(['notes'])

/** A price quote about a second robot, not the first-robot price this column holds. */
export function priceQuoteIsSecondRobot(quote: string | undefined): boolean {
  return /\b(b[- ]?team|second robot|2nd robot|additional robot|extra robot|per additional)\b/i.test(quote ?? '')
}

/** Same value, allowing for the spellings that do not change meaning. */
export function sameRefreshValue(key: RefreshKey, a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true
  if (isEmpty(a) || isEmpty(b)) return false
  if (URL_KEYS.has(key)) return bareUrl(String(a)) === bareUrl(String(b))
  if (NUMBER_KEYS.has(key)) return Number(a) === Number(b)
  if (DATE_KEYS.has(key)) return String(a).slice(0, 10) === String(b).slice(0, 10)
  if (key === 'country') return countryCode(String(a)) === countryCode(String(b))
  if (key === 'address') return streetKey(String(a)) === streetKey(String(b))
  return normaliseForQuoteMatch(String(a)) === normaliseForQuoteMatch(String(b))
}

/** A value as one side of "old → new" in an alert or a log line. */
export function fmtRefreshValue(value: unknown): string {
  if (isEmpty(value)) return '-'
  const s = String(value).replace(/\s+/g, ' ').trim()
  return s.length > 200 ? `${s.slice(0, 199)}…` : s
}

// #endregion

// #region plan

export type HoldReason =
  | 'human_claimed'
  | 'clears'
  | 'unproven'
  | 'past_date'
  | 'date_order'
  | 'reworded'
  | 'status_not_refreshable'
  | 'several_hosts'

export interface RefreshChange {
  key: RefreshKey
  label: string
  from: string
  to: string
}

export interface HeldChange extends RefreshChange {
  reason: HoldReason
}

export interface RefreshPlan {
  /** Columns to write, derived ones (seasonYear, hostTeamNumbers) included. */
  patch: Record<string, unknown>
  /** What changed, one per field, for the alert and the log. */
  applied: RefreshChange[]
  /** What differed and was not written, and why. Logged only. */
  held: HeldChange[]
  /** A place field changed and the pin is not claimed: geocode again. */
  needsGeocode: boolean
  /** The dates or the team list page changed: read the roster again now. */
  needsRosterRefresh: boolean
}

export interface RefreshPlanInput {
  /** The listing as it stands, read fresh right before planning. */
  current: Record<string, unknown> & { humanEditedFields?: readonly string[] | null }
  /** The reader's validated fields. An explicit null is a clear; a missing key is "not read". */
  fields: Partial<Record<RefreshKey, unknown>>
  /** The reader's evidence, a quote per field. */
  evidence: Record<string, { quote: string; source?: string } | undefined>
  /**
   * The text fetched THIS run, which is the only thing a quote can be proven
   * against: the thread body and every page the reader opened. Not the title
   * or the URLs we handed the reader, which are our own words.
   */
  sources: ReadonlyArray<NamedText<string>>
  /** YYYY-MM-DD. */
  today: string
}

/** True when the value is written in what was fetched this run. */
export function changeIsProven(
  key: RefreshKey,
  value: unknown,
  evidence: { quote: string } | undefined,
  sources: ReadonlyArray<NamedText<string>>,
): boolean {
  if (URL_KEYS.has(key)) return typeof value === 'string' && urlSource(value, sources) !== null
  const quote = evidence?.quote ?? ''
  return quoteSource(quote, sources, 10) !== null
}

/** The old value of a text field is still on the page: a rewording, not a change. */
function stillOnPage(value: unknown, sources: ReadonlyArray<NamedText<string>>): boolean {
  if (typeof value !== 'string') return false
  const needle = normaliseForQuoteMatch(value)
  if (needle.length < 4) return false
  return sources.some((s) => normaliseForQuoteMatch(s.text).includes(needle))
}

/**
 * Compare a fresh read with the listing and decide, field by field, what is
 * written. Pure: every rule in the header lives here, and the job only carries
 * it out.
 */
export function planEventRefresh(input: RefreshPlanInput): RefreshPlan {
  const { current, fields, evidence, sources, today } = input
  const claimed = current.humanEditedFields ?? null
  const patch: Record<string, unknown> = {}
  const applied: RefreshChange[] = []
  const held: HeldChange[] = []

  for (const key of REFRESH_KEYS) {
    if (!(key in fields)) continue
    const next = fields[key]
    const before = current[key]
    if (sameRefreshValue(key, before, next)) continue
    // A status that read 'unknown' and still reads 'unknown' is caught above.

    const change: RefreshChange = {
      key,
      label: REFRESH_FIELD_LABELS[key],
      from: fmtRefreshValue(before),
      to: fmtRefreshValue(next),
    }
    const hold = (reason: HoldReason) => held.push({ ...change, reason })

    if (NEVER_REFRESHED.has(key)) continue
    if (isHumanEdited(claimed, key)) { hold('human_claimed'); continue }
    if (isEmpty(next) || (STATUS_KEYS.has(key) && next === 'unknown' && !isEmpty(before) && before !== 'unknown')) {
      hold('clears')
      continue
    }
    if (key === 'eventStatus' && next !== 'tentative' && next !== 'confirmed') { hold('status_not_refreshable'); continue }
    if (DATE_KEYS.has(key) && String(next) < today) { hold('past_date'); continue }
    if (!changeIsProven(key, next, evidence[key], sources)) { hold('unproven'); continue }
    if (key === 'costUsd' && priceQuoteIsSecondRobot(evidence[key]?.quote)) { hold('unproven'); continue }
    // The old price still printed on the page means the page lists several
    // prices (first robot, B team, early bird), not that the price moved:
    // Rumble 11 lists $350 and $225 and the read picked the B-team one.
    if (key === 'costUsd' && before != null && stillOnPage(`$${Number(before)}`, sources)) { hold('reworded'); continue }
    if (REWORDABLE_KEYS.has(key) && stillOnPage(before, sources)) { hold('reworded'); continue }
    if (key === 'hostTeamNumber') {
      const hosts = Array.isArray(current.hostTeamNumbers) ? (current.hostTeamNumbers as unknown[]).map(Number) : []
      if (hosts.includes(Number(next))) continue
      // A co-hosted event: one number cannot describe it, and rewriting the
      // list from one read would drop the other hosts.
      if (hosts.length > 1) { hold('several_hosts'); continue }
      if (isHumanEdited(claimed, 'hostTeamNumbers')) { hold('human_claimed'); continue }
      patch.hostTeamNumbers = [Number(next)]
    }

    patch[key] = key === 'address' && typeof next === 'string' ? next.split(/[,\n]/)[0].trim() : next
    applied.push(change)
  }

  // The dates together must still make an event that ends on or after it starts.
  const start = (patch.startDate ?? current.startDate) as string | null | undefined
  const end = (patch.endDate ?? current.endDate) as string | null | undefined
  if (start && end && String(end) < String(start) && ('startDate' in patch || 'endDate' in patch)) {
    for (const key of ['startDate', 'endDate'] as const) {
      if (!(key in patch)) continue
      const i = applied.findIndex((c) => c.key === key)
      if (i >= 0) held.push({ ...applied.splice(i, 1)[0], reason: 'date_order' })
      delete patch[key]
    }
  }

  // The season is the year of the start date; a start that crossed a year moves it.
  if (typeof patch.startDate === 'string' && !isHumanEdited(claimed, 'seasonYear')) {
    const season = offseasonSeasonYear(patch.startDate)
    if (season !== null && season !== current.seasonYear) patch.seasonYear = season
  }

  const appliedKeys = new Set(applied.map((c) => c.key))
  const pinClaimed = isHumanEdited(claimed, 'latitude') || isHumanEdited(claimed, 'longitude')
  return {
    patch,
    applied,
    held,
    needsGeocode: !pinClaimed && [...PLACE_KEYS].some((k) => appliedKeys.has(k)),
    needsRosterRefresh: [...ROSTER_KEYS].some((k) => appliedKeys.has(k)),
  }
}

// #endregion

// #region eligibility

/**
 * Published, tentative or confirmed, and not over: the end date (else the
 * start date) is today or later. An undated event is refreshed too, because a
 * date is one of the things the refresh can find.
 */
export function isRefreshable(
  listing: { status: string; eventStatus: string | null; startDate: string | null; endDate: string | null },
  today: string,
): boolean {
  if (listing.status !== 'published') return false
  if (listing.eventStatus !== 'tentative' && listing.eventStatus !== 'confirmed') return false
  const last = listing.endDate ?? listing.startDate
  return !last || last >= today
}

// #endregion
