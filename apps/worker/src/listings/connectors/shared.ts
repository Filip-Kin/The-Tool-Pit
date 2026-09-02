/**
 * Deterministic helpers for the event and practice-field DISCOVER connectors.
 *
 * Everything here is a parser, not a guess. That is the whole design: Filip's
 * Anthropic credit is pay as you go and has run dry twice today, and a model
 * call to read a date off a forum post is a model call to produce a date
 * nobody can check. Where a parse is not certain, these functions return
 * nothing and the reviewer answers the question instead.
 */
import { parse } from 'node-html-parser'
import { canonicalGrantUrl } from '../../grants/connectors/shared.js'

/**
 * Canonical form used as the dedup key. This is canonicalGrantUrl, reused
 * rather than copied: it is pure URL work with nothing grant-shaped in it
 * (lowercase host, no fragment, tracking parameters dropped, real query
 * strings kept), and two copies would drift and then dedupe differently.
 */
export const canonicalListingUrl = canonicalGrantUrl

const URL_RE = /https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,}(?:\/[^\s"<>)'[\]]*)?/g

/**
 * Hosts that carry no information about an event or a field. Chief Delphi
 * itself is here because the THREAD is already the candidate's canonical URL;
 * an in-thread link back to the forum is navigation, not a lead.
 */
const NON_INFORMATIVE_HOSTS = [
  'chiefdelphi.com', 'imgur.com', 'i.imgur.com', 'youtube.com', 'youtu.be',
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com',
  'reddit.com', 'discord.gg', 'discord.com', 'wikipedia.org',
  'bit.ly', 'goo.gl', 'tinyurl.com', 't.co',
  'andymark.com', 'revrobotics.com', 'vexrobotics.com', 'wcproducts.com',
  'amazon.com', 'mcmaster.com',
]

export function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function isNonInformativeHost(url: string): boolean {
  const host = hostOf(url)
  if (!host) return true
  return NON_INFORMATIVE_HOSTS.some((b) => host === b || host.endsWith('.' + b))
}

/**
 * Outbound links from one post, in the order they appeared. Anchors first,
 * because Discourse linkifies most URLs, then a regex sweep for the ones typed
 * as plain text inside a code block or a quote.
 */
export function extractOutboundLinks(html: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()

  const push = (raw: string) => {
    const canonical = canonicalListingUrl(raw)
    if (!canonical) return
    if (isNonInformativeHost(canonical)) return
    if (seen.has(canonical)) return
    seen.add(canonical)
    found.push(canonical)
  }

  try {
    for (const anchor of parse(html).querySelectorAll('a')) {
      const href = anchor.getAttribute('href')?.trim()
      if (href && /^https?:\/\//i.test(href)) push(href)
    }
  } catch {
    // Malformed cooked HTML still has readable text below.
  }

  for (const raw of html.match(URL_RE) ?? []) push(raw)

  return found
}

/** Links that are a sign-up form rather than an information page. */
const REGISTRATION_URL_RE =
  /(?:^|[/.])(?:register|registration|signup|sign-up|apply|tickets?)|forms\.gle|docs\.google\.com\/forms|eventbrite\.|jotform\.|signupgenius\.|regfox\.|calendly\./i

export function looksLikeRegistrationUrl(url: string): boolean {
  return REGISTRATION_URL_RE.test(url)
}

/**
 * Hosts that are somebody else's product, never an event's own site.
 *
 * A Google Form, an Eventbrite page and a Discord invite are all things an
 * event links to. None of them is its website, and putting one in that field
 * tells a reader "this event has a site" and then sends them to a sign-up form.
 */
const NOT_A_WEBSITE_HOST =
  /(?:docs\.google\.com|forms\.gle|drive\.google\.com|eventbrite\.|jotform\.|signupgenius\.|regfox\.|calendly\.|discord\.(?:gg|com)|facebook\.com|instagram\.com|twitter\.com|x\.com|chiefdelphi\.com|thebluealliance\.com|linktr\.ee)/i

/**
 * Whether a link is plausibly the event's OWN site.
 *
 * The old rule was "any link that is not the registration link", so the second
 * form, a Discord invite or a sponsor became the website by being second in the
 * list. An event with no site of its own should simply have no website, which
 * is the honest answer and the one a reader can act on.
 */
export function looksLikeEventSite(url: string): boolean {
  if (looksLikeRegistrationUrl(url)) return false
  if (NOT_A_WEBSITE_HOST.test(url)) return false
  try {
    // A bare domain or a shallow path. A deep path is a page about something,
    // and the site itself is what belongs in this field.
    const parsed = new URL(url)
    return parsed.pathname.split('/').filter(Boolean).length <= 2
  } catch {
    return false
  }
}

// #region dates

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
}

const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')

/** "July 11, 2026" / "Jul 11 2026". */
const SINGLE_RE = new RegExp(String.raw`\b(${MONTH_ALT})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`, 'gi')
/** "July 11-12, 2026" / "July 11 to 12, 2026". */
const SAME_MONTH_RANGE_RE = new RegExp(
  String.raw`\b(${MONTH_ALT})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|—|to)\s*(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`,
  'gi',
)
/** "July 31 - August 1, 2026". */
const CROSS_MONTH_RANGE_RE = new RegExp(
  String.raw`\b(${MONTH_ALT})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|—|to)\s*(${MONTH_ALT})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`,
  'gi',
)
/** "2026-07-11". */
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g

export interface ParsedDates {
  /** ISO yyyy-mm-dd. Set only when exactly one date reading was found. */
  startDate?: string
  endDate?: string
  /** Every date-looking string seen, whether or not it was used. */
  evidence: string[]
  /** True when several different readings were found, so none was used. */
  ambiguous: boolean
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  // Rejects "February 31": the roll-over changes the month.
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Read dates out of prose, conservatively.
 *
 * Every pattern here demands an explicit four-digit year, so "the 11th" and
 * "July 11" never become a date: a bare day-and-month would silently take the
 * current year and put an event on the wrong side of a season. The year also
 * has to be plausible, which throws away "we have run this since 2011".
 *
 * When two DIFFERENT readings turn up, nothing is returned and `ambiguous` is
 * set. A thread that mentions both last year's event and this year's is common
 * and picking one is a coin toss a reviewer should not have to audit.
 */
export function parseExplicitDates(text: string, currentYear: number): ParsedDates {
  const minYear = currentYear - 1
  const maxYear = currentYear + 2
  const evidence: string[] = []
  const readings = new Map<string, { startDate: string; endDate?: string }>()

  const record = (raw: string, startDate: string | null, endDate?: string | null) => {
    if (!startDate) return
    evidence.push(raw.replace(/\s+/g, ' ').trim())
    readings.set(`${startDate}:${endDate ?? ''}`, {
      startDate,
      endDate: endDate ?? undefined,
    })
  }

  // Cross-month first, then same-month, then singles: the broader patterns
  // would otherwise each match half of a range and invent a second reading.
  const consumed: Array<[number, number]> = []
  const overlaps = (start: number, end: number) =>
    consumed.some(([s, e]) => start < e && end > s)

  for (const re of [CROSS_MONTH_RANGE_RE, SAME_MONTH_RANGE_RE, SINGLE_RE, ISO_RE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = m.index
      const end = m.index + m[0].length
      if (overlaps(start, end)) continue

      if (re === CROSS_MONTH_RANGE_RE) {
        const year = parseInt(m[5], 10)
        if (year < minYear || year > maxYear) continue
        consumed.push([start, end])
        record(
          m[0],
          iso(year, MONTHS[m[1].toLowerCase()], parseInt(m[2], 10)),
          iso(year, MONTHS[m[3].toLowerCase()], parseInt(m[4], 10)),
        )
      } else if (re === SAME_MONTH_RANGE_RE) {
        const year = parseInt(m[4], 10)
        if (year < minYear || year > maxYear) continue
        const month = MONTHS[m[1].toLowerCase()]
        consumed.push([start, end])
        record(m[0], iso(year, month, parseInt(m[2], 10)), iso(year, month, parseInt(m[3], 10)))
      } else if (re === SINGLE_RE) {
        const year = parseInt(m[3], 10)
        if (year < minYear || year > maxYear) continue
        consumed.push([start, end])
        record(m[0], iso(year, MONTHS[m[1].toLowerCase()], parseInt(m[2], 10)))
      } else {
        const year = parseInt(m[1], 10)
        if (year < minYear || year > maxYear) continue
        consumed.push([start, end])
        record(m[0], iso(year, parseInt(m[2], 10), parseInt(m[3], 10)))
      }
    }
  }

  if (readings.size !== 1) {
    return { evidence, ambiguous: readings.size > 1 }
  }
  const [only] = [...readings.values()]
  return { startDate: only.startDate, endDate: only.endDate, evidence, ambiguous: false }
}

/** Whole competition days from an inclusive date range, or undefined. */
export function daysBetween(startDate?: string, endDate?: string): number | undefined {
  if (!startDate) return undefined
  if (!endDate) return 1
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined
  return Math.round((end - start) / 86_400_000) + 1
}

// #endregion

/**
 * FRC team number from a thread TITLE, e.g. "Team 3538 Fall Classic".
 *
 * Titles only, and only behind an explicit "team" / "frc" / "ftc". A post body
 * names every team that ever helped and the first number in it is as likely to
 * be a guest as the host, and a bare number in a title is usually the year.
 */
export function parseTeamNumberFromTitle(title: string): { teamNumber?: number; evidence?: string } {
  const m = /\b(?:team|frc|ftc)\s*#?\s*(\d{1,5})\b/i.exec(title)
  if (!m) return {}
  const n = parseInt(m[1], 10)
  if (!Number.isInteger(n) || n < 1 || n > 99_999) return {}
  return { teamNumber: n, evidence: m[0] }
}

/**
 * FIRST program named in a title. Only when it is unambiguous: a thread that
 * says both FRC and FTC is a thread about an event with two divisions, and
 * picking one silently files it under the wrong map.
 */
export function parseProgramFromTitle(title: string): string | undefined {
  const frc = /\bfrc\b/i.test(title)
  const ftc = /\bftc\b/i.test(title)
  if (frc && !ftc) return 'frc'
  if (ftc && !frc) return 'ftc'
  return undefined
}

/** True when the topic was opened inside the recency window. */
export function withinRecencyWindow(createdAt: string | null, days: number): boolean {
  // No timestamp means the search response did not carry one. Keep the thread
  // rather than dropping it: a missing field is not evidence the thread is old.
  if (!createdAt) return true
  const opened = Date.parse(createdAt)
  if (Number.isNaN(opened)) return true
  return Date.now() - opened <= days * 86_400_000
}

/** Case-insensitive "does the haystack contain any of these phrases". */
export function matchedPhrases(haystack: string, phrases: string[]): string[] {
  const lower = haystack.toLowerCase()
  return phrases.filter((p) => lower.includes(p))
}

/**
 * Two phrase lists that both match IN THE SAME SENTENCE.
 *
 * "Somewhere in this thread there is the word field, and somewhere else there
 * is the word available" is not evidence of anything. The first live run of the
 * practice-field connector filed nine candidates and two were real. The seven
 * that were not included a blog post about algae, a thread on team churn rate
 * by region, and a discussion of how the California districts went. Every one
 * mentions a field somewhere and something like "available" somewhere else.
 *
 * A SENTENCE, not a character window. I tried 120 characters first and it still
 * accepted "...mentioned their practice field briefly. On a separate note the
 * new sensor is available to any team...", which is 58 characters apart and two
 * unrelated thoughts. Tightening the number would eventually exclude it and
 * would start excluding real offers at the same rate, because the thing that
 * makes it wrong is the full stop, not the distance.
 *
 * Returns the matched pair, for the reviewer's evidence list.
 */
export function phrasesInSameSentence(
  haystack: string,
  subjects: string[],
  qualifiers: string[],
): { subject: string; qualifier: string; sentence: string } | null {
  // Newlines split too: forum posts put separate thoughts on separate lines far
  // more often than they punctuate them.
  const sentences = haystack.toLowerCase().split(/[.!?;\n\r]+/)

  for (const sentence of sentences) {
    const subject = subjects.find((p) => sentence.includes(p))
    if (!subject) continue
    const qualifier = qualifiers.find((p) => sentence.includes(p))
    if (!qualifier) continue
    return { subject, qualifier, sentence: sentence.trim() }
  }

  return null
}
