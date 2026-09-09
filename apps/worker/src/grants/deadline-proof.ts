/**
 * A deadline, or proof there is not one yet.
 *
 * Every listing must say one of three things about timing, and say where it
 * got it: a dated deadline with the funder's sentence; the funder's own words
 * that the dates are not out yet ("FY27 application timeline is expected to
 * be posted by mid-September"); or that the pages were read and say nothing.
 * The model extractor finds most dated deadlines. This is the deterministic
 * layer that finds the SECOND kind, which the model kept dropping, and it
 * doubles as a cheap check on the first: the sentence must exist verbatim.
 *
 * Pure over page text; the caller supplies (url, text) pairs it has read.
 */

export interface DeadlineProof {
  kind: 'dated' | 'not_public' | 'rolling' | 'none'
  /** ISO date when kind is dated. */
  date?: string
  quote?: string
  url?: string
  /** For kind none: what was read. */
  urlsRead: string[]
  checkedAt: string
}

const MONTH = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)'
const DATE_RE = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b|\\b(\\d{1,2})\\s+${MONTH}\\.?\\s+(20\\d\\d)\\b|\\b(20\\d\\d)-(\\d{2})-(\\d{2})\\b|\\b(\\d{1,2})/(\\d{1,2})/(20\\d\\d)\\b`, 'i')
/** A strong cue: a bare "by" or "through" next to a date is a schedule, not a deadline. */
const DEADLINE_CUE = /(deadline|due (date|by|on)?\b|due\b|close[sd]?\b|closing|closes on|must be (submitted|received)|submit(ted)? (by|on or before|no later than)|received (by|on or before)|no later than|on or before|applications? (will )?(be )?(accepted|open) (until|through)|last day to (apply|submit)|final day)/i
/** Sentences that are page furniture, never evidence. */
const FURNITURE_RE = /^(skip|check the|click|select|sign in|log in|next page|previous|home|menu|search|share)\b/i
const NOT_PUBLIC_RE =
  /((timeline|dates?|application|applications|window|cycle|portal|form|details|guidelines)[^.]{0,80}(will be (posted|announced|available|released|published|open(ed|ing)?)|expected to (be posted|open|be announced)|to be announced|to be determined|tbd|not (yet )?(been )?(posted|announced|published|available|determined))|(will|expected to) open (in|on|by) [^.]{0,40}(20\d\d|spring|summer|fall|autumn|winter|early|late|mid)|next (application )?cycle [^.]{0,60}(expected|will|anticipated)|check back (soon|later|in)|coming soon|opens? (in|on) (early|mid|late)? ?(january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|autumn|winter))/i
const ROLLING_RE = /(rolling basis|reviewed as they arrive|no deadline|there are no deadlines|accepted (year|all year|year-round|throughout the year)|any time of (the )?year|ongoing basis)/i
const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }

function isoFromMatch(m: RegExpMatchArray): string | null {
  const pad = (n: number) => String(n).padStart(2, '0')
  if (m[1] && m[2] && m[3]) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()] ?? 0)}-${pad(Number(m[2]))}`
  if (m[4] && m[5] && m[6]) return `${m[6]}-${pad(MONTHS[m[5].toLowerCase()] ?? 0)}-${pad(Number(m[4]))}`
  if (m[7]) return `${m[7]}-${m[8]}-${m[9]}`
  if (m[10]) return `${m[12]}-${pad(Number(m[10]))}-${pad(Number(m[11]))}`
  return null
}

/** "November 15", "Nov. 15th", "15 November", "11/15" with no year: the next time that date comes round. */
const DATE_NO_YEAR_RE = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!,?\\s*20\\d\\d)|\\b(\\d{1,2})\\s+${MONTH}\\.?\\b(?!\\s*,?\\s*20\\d\\d)|\\b(\\d{1,2})/(\\d{1,2})\\b(?!/)`, 'i')
export function isoFromYearless(s: string, today: string): string | null {
  const m = s.match(DATE_NO_YEAR_RE)
  if (!m) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  let month = 0
  let day = 0
  if (m[1] && m[2]) { month = MONTHS[m[1].toLowerCase()] ?? 0; day = Number(m[2]) }
  else if (m[3] && m[4]) { month = MONTHS[m[4].toLowerCase()] ?? 0; day = Number(m[3]) }
  else if (m[5] && m[6]) { month = Number(m[5]); day = Number(m[6]) }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const year = Number(today.slice(0, 4))
  const thisYear = `${year}-${pad(month)}-${pad(day)}`
  return thisYear >= today ? thisYear : `${year + 1}-${pad(month)}-${pad(day)}`
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 320)
}

/**
 * Read the pages for a deadline sentence, a "not out yet" sentence, or a
 * rolling statement. Dated beats not-public beats rolling, and only a dated
 * sentence that is in the future (relative to `today`) counts as a deadline;
 * a past one is returned as none with the quote in urlsRead's neighbour, so a
 * caller can still show it as a past cycle.
 */
export function findDeadlineProof(pages: Array<{ url: string; text: string }>, today = new Date().toISOString().slice(0, 10)): DeadlineProof & { past?: { date: string; quote: string; url: string } } {
  const checkedAt = new Date().toISOString()
  const urlsRead = pages.map((p) => p.url)
  let notPublic: { quote: string; url: string } | null = null
  let rolling: { quote: string; url: string } | null = null
  let past: { date: string; quote: string; url: string } | null = null
  // A deadline written without a year ("Applications are due November 15")
  // is the next November 15. It is the funder's sentence all the same, and
  // most community foundations write it that way; it ranks below a sentence
  // with the year in it, above "nothing found".
  let yearless: { date: string; quote: string; url: string } | null = null
  for (const { url, text } of pages) {
    for (const s of sentences(text)) {
      if (FURNITURE_RE.test(s)) continue
      const dm = s.match(DATE_RE)
      if (dm && DEADLINE_CUE.test(s)) {
        const iso = isoFromMatch(dm)
        if (iso && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso)) {
          if (iso >= today) return { kind: 'dated', date: iso, quote: s.slice(0, 220), url, urlsRead, checkedAt }
          if (!past || iso > past.date) past = { date: iso, quote: s.slice(0, 220), url }
        }
      } else if (!dm && !yearless && DEADLINE_CUE.test(s)) {
        const iso = isoFromYearless(s, today)
        if (iso) yearless = { date: iso, quote: s.slice(0, 220), url }
      }
      if (!notPublic && NOT_PUBLIC_RE.test(s)) notPublic = { quote: s.slice(0, 220), url }
      if (!rolling && ROLLING_RE.test(s)) rolling = { quote: s.slice(0, 220), url }
    }
  }
  if (yearless && !notPublic) return { kind: 'dated', date: yearless.date, quote: yearless.quote, url: yearless.url, urlsRead, checkedAt, ...(past ? { past } : {}) }
  if (notPublic) return { kind: 'not_public', quote: notPublic.quote, url: notPublic.url, urlsRead, checkedAt, ...(past ? { past } : {}) }
  if (rolling) return { kind: 'rolling', quote: rolling.quote, url: rolling.url, urlsRead, checkedAt, ...(past ? { past } : {}) }
  return { kind: 'none', urlsRead, checkedAt, ...(past ? { past } : {}) }
}
