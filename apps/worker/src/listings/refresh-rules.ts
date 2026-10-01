/**
 * The rules every automatic refresh applies before it writes over a published
 * listing: fields (listings/field-refresh.ts), events
 * (listings/event-refresh-plan.ts) and tools (jobs/tool-refresh-rules.ts).
 *
 * WHY ONE MODULE. Events learned most of these the hard way (street spellings,
 * country spellings, a reworded venue) and fields did not reuse them, so the
 * first field run (2026-10-01) made 31 edits and 20 were reverted:
 *
 *   "500 Washington Street" -> "500 Washington St"          same street
 *   "United States" -> "US", eight times                     same country
 *   "...9:00 pm; SATURDAY" -> "...9:00 pm, SATURDAY"         same hours
 *   "Slice" -> "SLICE Robotics", "Mean Machine" -> "Team Mean Machine"
 *   "112 Quality Lane" -> "8 Stratton Road" off /contact-us  a mailing address
 *   hours -> "Sun, Aug 23, 2:30 PM - ..."                    sign-up dates
 *   year_round -> in_season off "2026-2027 ... Field Sign-Up" a heading
 *   sign-up link -> ".../contact"                            a generic page
 *   "Contact info@x.org for access" -> "info@x.org"          lost the condition
 *
 * Each rule below names the case it stops. Every function is pure.
 */
import { normaliseCountry } from '@the-tool-pit/db/country'
import { normaliseForQuoteMatch, quoteSource, type NamedText } from '../model/evidence.js'

// #region rule 1: same meaning is not a change

/** Words that carry no meaning in a schedule or a label: "Sat-Sun, from 10am-4pm". */
const FILLER_WORDS = new Set(['from', 'the', 'a', 'an', 'at', 'on', 'to', 'and', 'of'])

/**
 * Text with everything that does not change its meaning taken out: case,
 * spacing, punctuation (";" against ","), "&" against "and", filler words.
 */
export function meaningKey(value: string): string {
  return normaliseForQuoteMatch(value)
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}@]+/gu, ' ')
    .split(' ')
    .filter((w) => w && !FILLER_WORDS.has(w))
    .join(' ')
}

/** Same words in the same order, whatever the case, spacing, punctuation or filler. */
export function sameMeaningText(a: string | null | undefined, b: string | null | undefined): boolean {
  return meaningKey(a ?? '') === meaningKey(b ?? '')
}

/** "United States", "USA" and "US" are one country. Same normaliser the web app writes with. */
export function countryCode(value: string): string {
  return normaliseCountry(value) ?? ''
}

export function sameCountry(a: unknown, b: unknown): boolean {
  return countryCode(String(a ?? '')) === countryCode(String(b ?? ''))
}

const STREET_ABBR: Array<[RegExp, string]> = [
  [/\bsoutheast\b/g, 'se'], [/\bsouthwest\b/g, 'sw'], [/\bnortheast\b/g, 'ne'], [/\bnorthwest\b/g, 'nw'],
  [/\bnorth\b/g, 'n'], [/\bsouth\b/g, 's'], [/\beast\b/g, 'e'], [/\bwest\b/g, 'w'],
  [/\bstreet\b/g, 'st'], [/\bavenue\b/g, 'ave'], [/\bav\b/g, 'ave'], [/\broad\b/g, 'rd'], [/\bdrive\b/g, 'dr'],
  [/\bboulevard\b/g, 'blvd'], [/\bhighway\b/g, 'hwy'], [/\blane\b/g, 'ln'], [/\bparkway\b/g, 'pkwy'],
  [/\bcourt\b/g, 'ct'], [/\bplace\b/g, 'pl'], [/\bcircle\b/g, 'cir'], [/\bterrace\b/g, 'ter'],
  [/\btrail\b/g, 'trl'], [/\bsuite\b/g, 'ste'], [/\bmount\b/g, 'mt'], [/\bsaint\b/g, 'st'],
]

/** Any text with street words folded: "201 North Douglas Street" -> "201 n douglas st". */
export function foldStreetText(value: string): string {
  let v = normaliseForQuoteMatch(value).replace(/[.#,;:()]/g, ' ')
  for (const [re, to] of STREET_ABBR) v = v.replace(re, to)
  return v.replace(/\s+/g, ' ').trim()
}

/**
 * The street line only, abbreviations folded: "23499 Southeast Tahoma Way"
 * and "23499 SE Tahoma Way, Maple Valley, Washington, 98038" are one address.
 * City, state and zip have their own columns.
 */
export function streetKey(value: string): string {
  return foldStreetText(value.split(/[,\n]/)[0] ?? '')
}

const TRAILING_DIRECTION = /\s(?:n|s|e|w|ne|nw|se|sw)$/

/**
 * One street, however it is spelled. Besides the abbreviations, one side may
 * drop a trailing direction: "1590 Bill Murdock Road Northeast" and
 * "1590 Bill Murdock Rd" are the same building.
 */
export function sameStreet(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = streetKey(a ?? '')
  const kb = streetKey(b ?? '')
  if (ka === kb) return true
  return ka.replace(TRAILING_DIRECTION, '') === kb || kb.replace(TRAILING_DIRECTION, '') === ka
}

// #endregion

// #region rule 2: names of teams and organisations

/**
 * A team or organisation name is never rewritten by a refresh. A team's site
 * calls it "SLICE Robotics" on one page and "Slice" on another; "Rutland Area
 * Robotics" runs a team called "The IBOTS"; neither is the listing changing.
 */
export const ORG_NAME_KEYS: ReadonlySet<string> = new Set(['teamName', 'hostTeamName', 'organizer', 'orgName'])

// #endregion

// #region page kinds

/** Last path segments of a page that is about the organisation, not one place or one form. */
const GENERIC_PAGE_SEGMENTS = new Set([
  'contact', 'contact-us', 'contactus', 'contact_us', 'contacts',
  'about', 'about-us', 'aboutus', 'about_us',
  'donate', 'donations', 'donation', 'support-us', 'sponsor', 'sponsors',
  'get-involved', 'getinvolved', 'get_involved', 'join', 'join-us',
])

function parseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** A /contact, /contact-us, /about, /donate or /get-involved page. */
export function isGenericPageUrl(url: string | null | undefined): boolean {
  const u = url ? parseUrl(url) : null
  if (!u) return false
  const segments = u.pathname.split('/').filter(Boolean)
  const last = (segments[segments.length - 1] ?? '').toLowerCase().replace(/\.(?:html?|php|aspx?)$/, '')
  return GENERIC_PAGE_SEGMENTS.has(last)
}

/** The site's front page: no path, or index/home, and no query. */
export function isSiteHomeUrl(url: string | null | undefined): boolean {
  const u = url ? parseUrl(url) : null
  if (!u) return false
  if (u.search && u.search !== '?') return false
  const path = u.pathname.replace(/\/+$/, '').toLowerCase()
  return path === '' || /^\/(?:index\.(?:html?|php)|home)$/.test(path)
}

// #endregion

// #region rule 3: address

/**
 * A new street address is taken only from a page about the place, never a
 * contact, about or donate page (that address is where the team gets mail),
 * and only when the quote itself holds the new street.
 */
export function addressRefusal(
  next: string,
  quote: string,
  sources: ReadonlyArray<NamedText<string>>,
): string | null {
  const street = streetKey(next)
  if (!street || !foldStreetText(quote).includes(street)) return 'quote does not hold the new street'
  const placePages = sources.filter((s) => !isGenericPageUrl(s.source))
  if (!quoteSource(quote, placePages, 10)) return 'address only on a contact or about page'
  return null
}

// #endregion

// #region rule 3b: city and region

/**
 * A city or region comes from an address, not a name: "Asheville High
 * School's robotics team" is in Alexander. The quote must hold the new value
 * next to something only an address has: a street number or postal code, or
 * "City, ST".
 */
export function placeRefusal(next: string, quote: string): string | null {
  const q = normaliseForQuoteMatch(quote)
  const v = normaliseForQuoteMatch(next)
  if (!v || !q.includes(v)) return 'quote does not hold the new place'
  if (/\d{3,}/.test(q)) return null
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`${esc},\\s*[a-z]{2,}`).test(q) || new RegExp(`[a-z]+,\\s*${esc}`).test(q)) return null
  return 'not from an address'
}

// #endregion

// #region rule 4: hours are a recurring schedule

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const DATE_PATTERNS = [
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'i'),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?![a-z])`, 'i'),
  /\b\d{4}-\d{1,2}-\d{1,2}\b/,
  /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])(?:\/\d{2,4})?\b/,
]

/** Hosts that serve forms: the time choices on a request form are slots, not opening hours. */
const FORM_HOSTS = /(?:^|\.)(?:forms\.gle|docs\.google\.com|forms\.office\.com|typeform\.com|jotform\.com|signupgenius\.com|calendly\.com)$/i
const DAY_OR_TIME =
  /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\bweek(?:day|end|night)s?\b|\bdaily\b|\bevery day\b|\bnightly\b|\b24\/7\b|\bnoon\b|\bmidnight\b|\d\s*(?:am|pm|a\.m\.|p\.m\.)|\b\d{1,2}:\d{2}\b/i

/**
 * Opening hours repeat. Refused:
 *  - a calendar date in the value or in its quote ("Sun, Aug 23", "8/23",
 *    "2026-08-23"): a list of sign-up sessions, stale the week after, even
 *    when the reader summarises it as "Various Sunday afternoons";
 *  - a quote from a form (forms.gle and the like): its time choices are the
 *    slots a team can ask for, not when the field is open;
 *  - a value with no day and no time in it ("Please sign up for a maximum of
 *    one session per week"): a rule about booking, not hours.
 */
export function hoursRefusal(next: string, quote = '', source?: string | null): string | null {
  if (DATE_PATTERNS.some((re) => re.test(next) || re.test(quote))) return 'dates, not a recurring schedule'
  const host = source ? parseUrl(source)?.hostname ?? '' : ''
  if (host && FORM_HOSTS.test(host)) return 'form choices, not opening hours'
  if (!DAY_OR_TIME.test(next)) return 'no days or times'
  return null
}

// #endregion

// #region rule 5: availability only on explicit words

const AVAILABILITY_WORDS: Record<string, RegExp> = {
  year_round: /\b(?:year[- ]?round|all year|all-year|twelve months|12 months|by appointment)\b/i,
  in_season: /\b(?:in[- ]season|during (?:the )?(?:build |competition )?season|season only|off[- ]season only|build season only)\b/i,
}

/**
 * Availability changes only when the quote says it in words: "year round",
 * "in season", "off-season only", "by appointment". A heading such as
 * "2026-2027 Vitruvian Bots Field Sign-Up" names a season; it does not say the
 * field is closed the rest of the year.
 */
export function availabilityRefusal(next: string, quote: string): string | null {
  const words = AVAILABILITY_WORDS[next]
  if (!words) return null
  return words.test(normaliseForQuoteMatch(quote)) ? null : 'no explicit availability wording'
}

// #endregion

// #region rule 6: a sign-up link is a form

/** A sign-up or registration link must be the form, not the site's contact, about or front page. */
export function signupLinkRefusal(url: string): string | null {
  if (isSiteHomeUrl(url)) return 'site home page, not a sign-up form'
  if (isGenericPageUrl(url)) return 'generic contact page, not a sign-up form'
  return null
}

// #endregion

// #region rule 7: contact text

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]]+/gi
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g
/** Words that put a condition on contact. Dropping one loses the condition. */
const CONDITION_WORDS = ['for access', 'veto', 'approval', 'approve', 'district', 'only', 'permission']

/** The emails, links and phone numbers in a contact value, each in a comparable form. */
export function contactTokens(value: string): { emails: string[]; urls: string[]; phones: string[] } {
  const emails = (value.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase())
  const urls = (value.match(URL_RE) ?? []).map((u) =>
    u.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/.]+$/, ''),
  )
  const phones = (value.match(PHONE_RE) ?? []).map((p) => p.replace(/\D/g, '').slice(-10))
  return { emails, urls, phones }
}

/**
 * Contact text is replaced only when the old one is gone. The old value's
 * email, link or phone still on the fetched pages means it is still right,
 * and the new one is a different pick from the same page. A replacement must
 * also keep any condition ("for access", "district may veto") that the pages
 * still state.
 */
export function contactRefusal(
  prev: string | null | undefined,
  next: string,
  sources: ReadonlyArray<NamedText<string>>,
): string | null {
  if (!prev || !prev.trim()) return null
  const pages = sources.map((s) => normaliseForQuoteMatch(s.text ?? ''))
  const bare = pages.map((p) => p.replace(/https?:\/\//g, '').replace(/www\./g, ''))
  const digits = sources.map((s) => (s.text ?? '').replace(/\D/g, ''))

  const old = contactTokens(prev)
  if (old.emails.some((e) => pages.some((p) => p.includes(e)))) return 'old contact still on the page'
  if (old.urls.some((u) => bare.some((p) => p.includes(u)))) return 'old contact still on the page'
  if (old.phones.some((d) => d.length === 10 && digits.some((p) => p.includes(d)))) return 'old contact still on the page'

  const prevText = normaliseForQuoteMatch(prev)
  const nextText = normaliseForQuoteMatch(next)
  for (const word of CONDITION_WORDS) {
    const re = new RegExp(`\\b${word}\\b`)
    if (re.test(prevText) && !re.test(nextText) && pages.some((p) => re.test(p))) {
      return `drops "${word}", still on the page`
    }
  }
  return null
}

// #endregion

// #region one entry point

export type GuardKind = 'address' | 'place' | 'hours' | 'availability' | 'signupLink' | 'contactText' | 'orgName'

/**
 * Why a proven change must still not be written, or null. Called after the
 * quote has been checked against the fetched text.
 */
export function guardRefusal(
  kind: GuardKind,
  input: { from: unknown; to: unknown; quote: string; source?: string | null; sources: ReadonlyArray<NamedText<string>> },
): string | null {
  const to = String(input.to ?? '')
  switch (kind) {
    case 'orgName':
      return 'team or organisation name, never refreshed'
    case 'address':
      return addressRefusal(to, input.quote, input.sources)
    case 'place':
      return placeRefusal(to, input.quote)
    case 'hours':
      return hoursRefusal(to, input.quote, input.source)
    case 'availability':
      return availabilityRefusal(to, input.quote)
    case 'signupLink':
      return signupLinkRefusal(to)
    case 'contactText':
      return contactRefusal(typeof input.from === 'string' ? input.from : null, to, input.sources)
  }
}

// #endregion
