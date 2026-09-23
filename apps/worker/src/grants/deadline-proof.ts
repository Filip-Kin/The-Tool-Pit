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
 *
 * A date proves a deadline only when all of these hold (2026-09-23 audit: 30
 * cycles were written from this file and many were false):
 *   - the words just before it tie it to applying (apply, application,
 *     submit, proposal, due, deadline, closes), not to a report, a
 *     notification, an event or a calendar-year limit;
 *   - it carries its own year. "Due by April 17" is a recurring note, never
 *     next year's deadline: nothing here adds or rolls a year;
 *   - the page is the funder's. A grant-finder's page (grantable.co projects
 *     next year's date from last year's) or an archive copy proves nothing;
 *   - it is not in a section about another fund on the same page (Cleveland
 *     Foundation's "Application Deadline May 11" belongs to the Black
 *     Philanthropy Fund, not its standard grant).
 */
import { isThirdPartyGrantUrl } from '@the-tool-pit/db/grant-urls'

export interface DeadlineProof {
  /**
   * recurring: the funder gives a deadline as a day with no year ("due by
   * April 17"). That is the grant's pattern, not a dated round.
   */
  kind: 'dated' | 'recurring' | 'not_public' | 'rolling' | 'none'
  /** ISO date when kind is dated. */
  date?: string
  /** "MM-DD" when kind is recurring. */
  monthDay?: string
  /** ISO date the window opens, when the funder wrote a period ("Application Period: 5/18/2026 - 6/29/2026"). */
  opens?: string
  quote?: string
  url?: string
  /** For kind none: what was read. */
  urlsRead: string[]
  checkedAt: string
}

const MONTH = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)'
export const DATE_RE = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b|\\b(\\d{1,2})\\s+${MONTH}\\.?\\s+(20\\d\\d)\\b|\\b(20\\d\\d)-(\\d{2})-(\\d{2})\\b|\\b(\\d{1,2})/(\\d{1,2})/(20\\d\\d)\\b`, 'i')
/** A strong cue: a bare "by" or "through" next to a date is a schedule, not a deadline. */
export const DEADLINE_CUE = /(deadline|due (date|by|on)?\b|due\b(?!\s+to\s+(the\s+)?(volume|high|large|limited|number|lack|budget|demand|covid|circumstances|popular))|close[sd]?\b|closing|closes on|must be (submitted|received)|submit(ted)? (by|on or before|no later than)|received (by|on or before)|no later than|on or before|applications? (will )?(be )?(accepted|open) (until|through)|last day to (apply|submit)|final day)/i
/**
 * A deadline for something else: a scholarship on a grants page, a
 * recommendation letter, a report, an invoice, a webinar. Not the round.
 */
export const OTHER_DEADLINE_RE = /\b(scholarships?|fellowships?|recommendation letters?|letters? of recommendation|transcripts?|final report|progress report|interim report|reporting deadline|invoice|reimbursement request|webinar|info(rmation)? session|office hours|early bird|registration for the (conference|event|gala))\b/i

/**
 * The date that belongs to the deadline word. A timeline table reads
 * "FORM OPENS August 17, 2026 ... DEADLINE FOR SUBMISSION September 17,
 * 2026" as one row, and the first date in it is the opening. Take the first
 * date AFTER the first cue word; when no date follows a cue, the nearest
 * date before one.
 */
export function dateForCue(s: string): RegExpMatchArray | null {
  const dates = [...s.matchAll(new RegExp(DATE_RE.source, 'gi'))]
  if (dates.length === 0) return null
  if (dates.length === 1) return dates[0]
  const cues = [...s.matchAll(new RegExp(DEADLINE_CUE.source, 'gi'))]
  if (cues.length === 0) return dates[0]
  for (const c of cues) {
    const after = dates.find((d) => (d.index ?? 0) > (c.index ?? 0) && (d.index ?? 0) - (c.index ?? 0) < 90)
    if (after) return after
  }
  const firstCue = cues[0].index ?? 0
  const before = [...dates].reverse().find((d) => (d.index ?? 0) < firstCue)
  return before ?? dates[0]
}

/** Sentences that are page furniture, never evidence. */
const FURNITURE_RE = /^(skip|check the|click|select|sign in|log in|next page|previous|home|menu|search|share)\b/i
const NOT_PUBLIC_RE =
  /((timeline|dates?|application|applications|window|cycle|portal|form|details|guidelines)[^.]{0,80}(will be (posted|announced|available|released|published|open(ed|ing)?)|expected to (be posted|open|be announced)|to be announced|to be determined|tbd|not (yet )?(been )?(posted|announced|published|available|determined))|(will|expected to) open (in|on|by) [^.]{0,40}(20\d\d|spring|summer|fall|autumn|winter|early|late|mid)|next (application )?cycle [^.]{0,60}(expected|will|anticipated)|check back (soon|later|in)|coming soon|opens? (in|on) (early|mid|late)? ?(january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|autumn|winter))/i
const ROLLING_RE = /(rolling basis|reviewed as they arrive|no deadline|there are no deadlines|accepted (year|all year|year-round|throughout the year)|any time of (the )?year|ongoing basis)/i
const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }

export function isoFromMatch(m: RegExpMatchArray): string | null {
  const pad = (n: number) => String(n).padStart(2, '0')
  if (m[1] && m[2] && m[3]) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()] ?? 0)}-${pad(Number(m[2]))}`
  if (m[4] && m[5] && m[6]) return `${m[6]}-${pad(MONTHS[m[5].toLowerCase()] ?? 0)}-${pad(Number(m[4]))}`
  if (m[7]) return `${m[7]}-${m[8]}-${m[9]}`
  if (m[10]) return `${m[12]}-${pad(Number(m[10]))}-${pad(Number(m[11]))}`
  return null
}

/**
 * "November 15", "Nov. 15th", "15 November", "11/15" with no year, as
 * "MM-DD". No year is added: a date the funder wrote without one is the
 * grant's pattern, and rolling it to "the next November 15" is how "due by
 * April 17" (Marion County, the 2026 round) became an open 2027 deadline.
 */
const DATE_NO_YEAR_RE = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!,?\\s*20\\d\\d)|\\b(\\d{1,2})\\s+${MONTH}\\.?\\b(?!\\s*,?\\s*20\\d\\d)|\\b(\\d{1,2})/(\\d{1,2})\\b(?!/)`, 'i')
export function monthDayFromYearless(s: string): string | null {
  const m = s.match(DATE_NO_YEAR_RE)
  if (!m) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  let month = 0
  let day = 0
  if (m[1] && m[2]) { month = MONTHS[m[1].toLowerCase()] ?? 0; day = Number(m[2]) }
  else if (m[3] && m[4]) { month = MONTHS[m[4].toLowerCase()] ?? 0; day = Number(m[3]) }
  else if (m[5] && m[6]) { month = Number(m[5]); day = Number(m[6]) }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${pad(month)}-${pad(day)}`
}

/**
 * "Application Period: 5/18/2026 - 6/29/2026", "Applications accepted
 * March 1 through April 15, 2026", "Grant cycle opens January 15 and closes
 * February 28". A window has no deadline word, so the sentence rules miss it;
 * the END of the window is the deadline. Scanned over the whole text because
 * funders write these as table rows and pipe-separated lines, not sentences.
 */
const WINDOW_RE = new RegExp(`\\b(application|applications|grant|funding|proposal|submission|nomination|rfp|cycle|round)s?\\s*(period|window|cycle|dates?|timeline|open|opens|accepted|are accepted|will be accepted)?\\s*[:\\-–]?\\s*(?:from\\s+)?(${DATE_RE.source})\\s*(?:-|–|to|through|until|thru)\\s*(${DATE_RE.source})`, 'gi')
export function windowsIn(text: string, today: string): Array<{ opens: string; date: string; quote: string }> {
  return windowsInFlat(text.replace(/\s+/g, ' '), today).map(({ opens, date, quote }) => ({ opens, date, quote }))
}

function windowsInFlat(flat: string, today: string): Array<{ opens: string; date: string; quote: string; index: number }> {
  const out: Array<{ opens: string; date: string; quote: string; index: number }> = []
  for (const m of flat.matchAll(WINDOW_RE)) {
    const a = m[3].match(DATE_RE)
    const first = a ? isoFromMatch(a) : null
    const rest = flat.slice((m.index ?? 0) + m[0].indexOf(m[3]) + m[3].length)
    const second = rest.match(DATE_RE)
    const end = second ? isoFromMatch(second) : null
    if (!first || !end || end < first) continue
    // "FY 2027: July 1, 2026 - June 30, 2027" is the year the money covers,
    // not the weeks the form is open. A window longer than about six months,
    // or one the text calls a fiscal year, grant period or project period,
    // is not an application window.
    const spanDays = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000
    const before = flat.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + 40)
    if (spanDays > 200 || /\b(fy\s?\d{2,4}|fiscal year|grant period|project period|funding period|performance period|award period|program year|school year)\b/i.test(before)) continue
    out.push({ opens: first, date: end, index: m.index ?? 0, quote: flat.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + m[0].length + 20).trim().slice(0, 220) })
  }
  void today
  return out.sort((x, y) => x.date.localeCompare(y.date))
}

// #region whose date is it

/**
 * The words that tie a date to applying. Checked on the stretch just before
 * the date, so "Applications are due" counts and "Impact Reports Due" in the
 * next table row does not.
 */
const APPLY_TIE_RE = /\b(appl(y|ying|ications?|icants?)|submi(t|ts|tted|tting|ssions?)|proposals?|LOIs?|letters? of (intent|inquiry|interest)|requests?|nominations?|due|deadlines?|close[sd]?|closing)\b/i
/**
 * A date for something other than applying to this round: a report, a
 * notification, a meeting, an event, a limit of one request per calendar
 * year ("within a calendar year (January 1 – December 31)", Harbor Freight).
 */
const NOT_APPLYING_RE = /\b(reports?|reporting|notif(y|ied|ication|ications)|announce(d|ment|ments)?|awards? (will be )?(announced|made|notifications?|decisions?)|awarded|decisions? (are |will be )?(made|announced|sent)|meetings?|event date|calendar year|fiscal year|webinars?|info(rmation)? sessions?|conference|gala|ceremony|payments?|disburse\w*|site visits?|interviews?|expenditures?|reimburse\w*|funds? (must be )?(spent|expended)|grant period|project period)\b/i
/** How far back from a date its tie may sit, and never past the previous date. */
const LEAD_REACH = 120

/** Words that say "a programme" without naming one. */
const GENERIC_WORDS = new Set([
  'the', 'a', 'an', 'and', 'of', 'for', 'in', 'on', 'to', 'at', 'by', 'our', 'your', 'its', 'this', 'that', 'with',
  'grant', 'grants', 'grantmaking', 'fund', 'funds', 'funding', 'foundation', 'foundations', 'program', 'programs', 'programme', 'programmes',
  'award', 'awards', 'initiative', 'initiatives', 'scholarship', 'scholarships', 'fellowship', 'fellowships', 'prize', 'challenge', 'sponsorship', 'sponsorships',
  'application', 'applications', 'apply', 'deadline', 'deadlines', 'amount', 'eligibility', 'overview', 'how', 'about', 'other', 'opportunity', 'opportunities',
  'information', 'details', 'guidelines', 'process', 'timeline', 'faq', 'faqs', 'frequently', 'asked', 'questions', 'community', 'communities', 'types', 'current',
  'past', 'open', 'closed', 'key', 'dates', 'important', 'request', 'requests', 'what', 'we', 'who', 'can', 'when', 'where', 'why', 'eligible', 'criteria',
  'requirements', 'contact', 'us', 'more', 'learn', 'annual', 'general', 'standard', 'new', 'next', 'cycle', 'round', 'team', 'teams', 'first', 'robotics',
  'competition', 'frc', 'ftc', 'fll', 'stem', 'lego', 'league', 'tech', 'youth', 'education', 'educational', 'giving', 'charitable', 'corporate', 'inc', 'llc',
  'company', 'corporation', 'co', 'trust', 'mini', 'small', 'local', 'support', 'partner', 'partners', 'partnership', 'k', '12',
  'search', 'find', 'view', 'browse', 'all', 'see', 'list', 'explore', 'form', 'forms', 'powerform', 'docusign', 'click', 'here', 'online', 'portal', 'link', 'page',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'spring', 'summer', 'fall', 'autumn', 'winter',
])
/** Title case: "Black Philanthropy Fund" is a heading, "For grant requests of $3,000 or less" is not. */
const PROGRAMME_HEADING_RE = /^[A-Z0-9"“].*\b(Fund|Foundation|Grants?|Program(me)?s?|Awards?|Initiative|Scholarships?|Fellowships?|Prize|Challenge|Sponsorships?)(\s*\([^)]*\))?$/
/** A capitalised run ending in a programme noun: "Equity in the Arts Fund", "Boeing Team Grant". */
const PROGRAMME_NAME_RE = /((?:[A-Z0-9][\w&'’-]*\s+(?:(?:of|the|and|for|in|&)\s+)*){1,6})(Fund|Foundation|Grants?|Program(?:me)?s?|Awards?|Initiative|Scholarships?|Fellowships?|Prize|Challenge)\b/g

function distinctive(text: string, exclude: Set<string>): Set<string> {
  const out = new Set<string>()
  for (const w of text.toLowerCase().replace(/[®™]/g, '').split(/[^a-z0-9]+/)) {
    if (w.length < 2 || GENERIC_WORDS.has(w) || exclude.has(w) || /^(\d+|fy\d+)$/.test(w)) continue
    out.add(w)
  }
  return out
}

export interface ProofContext {
  /** The programme the proof is for: the extraction's or the listing's name. */
  programName?: string | null
  funderName?: string | null
}

type Owner = 'ours' | 'other' | 'neutral'

/**
 * Whether a heading or an inline programme name is this programme, another
 * one, or says nothing either way. The funder's own name says nothing: the
 * Cleveland Foundation's page names the Cleveland Foundation everywhere.
 */
function ownerOf(name: string, ctx: ProofContext): Owner {
  const funder = distinctive(ctx.funderName ?? '', new Set())
  const words = distinctive(name, funder)
  if (words.size === 0) return 'neutral'
  const ours = distinctive(ctx.programName ?? '', funder)
  for (const w of words) if (ours.has(w)) return 'ours'
  // Our name is the funder's name and generic words ("AMSTI Robotics
  // Grant"): a name carrying the funder ("PowerForm for the FY27 AMSTI
  // Robotics Grant") may be ours, so it says nothing either way.
  if (ours.size === 0 && [...distinctive(name, new Set())].some((w) => funder.has(w))) return 'neutral'
  return 'other'
}

/** A short line with no full stop that names a programme: a section heading. */
function headingName(line: string): string | null {
  const t = line.trim()
  if (t.length < 4 || t.length > 80 || t.split(/\s+/).length > 10) return null
  // A programme heading ENDS with the programme noun ("Black Philanthropy
  // Fund", "Boeing Team Grant"); "FIRST Tech Challenge: December 25, 2026"
  // and "Team Grant FAQs" are a table row and a link.
  if (!PROGRAMME_HEADING_RE.test(t) || /[:@]/.test(t) || DATE_RE.test(t)) return null
  return t
}

/** The programme names written in a stretch of text. */
function programmeNamesIn(text: string): string[] {
  return [...text.matchAll(PROGRAMME_NAME_RE)].map((m) => m[0])
}

interface PageLayout {
  flat: string
  /** For each flat offset where a line starts, the programme heading in force there. */
  lines: Array<{ start: number; heading: string | null }>
}

function layout(text: string): PageLayout {
  const lines: PageLayout['lines'] = []
  let flat = ''
  let heading: string | null = null
  for (const raw of text.split(/\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    // "Grant Amount" and "Other Grant Opportunities" are headings that name
    // no programme; they do not end the section of the fund above them.
    const h = headingName(line)
    if (h && distinctive(h, new Set()).size > 0) heading = h
    if (flat) flat += ' '
    lines.push({ start: flat.length, heading })
    flat += line
  }
  return { flat, lines }
}

function headingAt(page: PageLayout, index: number): string | null {
  let heading: string | null = null
  for (const l of page.lines) {
    if (l.start > index) break
    heading = l.heading
  }
  return heading
}

/** How far back the paragraph around a date reaches: its own line and the two before it. */
const PARAGRAPH_LINES = 2
const PARAGRAPH_REACH = 400

/**
 * True when the date at `index` (an offset in the flattened page) belongs to
 * another programme: its section heading names one, or its paragraph (its
 * own line and the two before, up to the end of its line) names another
 * programme and not this one. The end of the line and no further: in a
 * flattened table the next fund's heading ("May 11 Equity in the Arts Fund")
 * runs on right after the date.
 */
function belongsElsewhere(page: PageLayout, index: number, ctx: ProofContext): boolean {
  if (!ctx.programName?.trim()) return false
  const heading = headingAt(page, index)
  if (heading && ownerOf(heading, ctx) === 'other') return true
  let line = 0
  while (line + 1 < page.lines.length && page.lines[line + 1].start <= index) line++
  const from = Math.max(page.lines[Math.max(0, line - PARAGRAPH_LINES)]?.start ?? 0, index - PARAGRAPH_REACH)
  const to = page.lines[line + 1]?.start ?? page.flat.length
  const owners = programmeNamesIn(page.flat.slice(from, to)).map((n) => ownerOf(n, ctx))
  return owners.includes('other') && !owners.includes('ours')
}

/** How far before a date its passage may name the programme or funder. */
const MENTION_REACH = 600

function ourWords(ctx: ProofContext): Set<string> {
  return new Set([...distinctive(ctx.programName ?? '', new Set()), ...distinctive(ctx.funderName ?? '', new Set())])
}

/** A page naming this many other programmes is a list of them. */
const MULTI_PROGRAMME_NAMES = 3

/** True when the page names several programmes that are not this one. */
function listsOtherProgrammes(flat: string, ctx: ProofContext): boolean {
  if (!ctx.programName?.trim()) return false
  const others = new Set<string>()
  for (const n of programmeNamesIn(flat)) {
    if (ownerOf(n, ctx) !== 'other') continue
    others.add([...distinctive(n, distinctive(ctx.funderName ?? '', new Set()))].sort().join(' '))
  }
  return others.size >= MULTI_PROGRAMME_NAMES
}

/** True when the passage leading to a date names this programme or its funder. */
function mentionsUs(flat: string, sentenceStart: number, dateIndex: number, ctx: ProofContext): boolean {
  const words = ourWords(ctx)
  if (words.size === 0) return false
  const passage = distinctive(flat.slice(Math.max(0, Math.min(sentenceStart, dateIndex - MENTION_REACH)), dateIndex), new Set())
  for (const w of words) if (passage.has(w)) return true
  return false
}

/** The stretch before a date that has to say "apply" and not "report". */
function leadOf(sentence: string, dateIndex: number, prevDateEnd: number): string {
  const lead = sentence.slice(Math.max(0, prevDateEnd, dateIndex - LEAD_REACH), dateIndex)
  // A year or month-and-year ends the row before it: "Grant Announcement via
  // Memo: July 2026 Grant Application Submitted online no later than" (AMSTI)
  // ties the date to the application, not the announcement.
  const rowEnds = [...lead.matchAll(ROW_END_RE)]
  const last = rowEnds[rowEnds.length - 1]
  return last ? lead.slice((last.index ?? 0) + last[0].length) : lead
}
const ROW_END_RE = new RegExp(`\\b(?:${MONTH}\\.?\\s+)?20\\d\\d\\b(?!\\s*[-–]\\s*(20)?\\d\\d)`, 'gi')

function tiedToApplying(lead: string): boolean {
  if (!APPLY_TIE_RE.test(lead) || !DEADLINE_CUE.test(lead) || NOT_APPLYING_RE.test(lead)) return false
  // "Grant applications are currently closed and will reopen January 4,
  // 2027" (Midco): the word nearest the date is an opening, so the date is.
  const lastEnd = (re: RegExp) => Math.max(-1, ...[...lead.matchAll(new RegExp(re.source, 'gi'))].map((m) => (m.index ?? 0) + m[0].length))
  return lastEnd(DEADLINE_CUE) >= lastEnd(OPENING_RE)
}
const OPENING_RE = /\b((re)?open(s|ed|ing)?|begin(s|ning)?|start(s|ing)?|available|launch(es)?|accepting)\b/

// #endregion

function sentences(flat: string): Array<{ text: string; index: number }> {
  const out: Array<{ text: string; index: number }> = []
  let start = 0
  const push = (end: number) => {
    const raw = flat.slice(start, end)
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text.length >= 12 && text.length <= 700) out.push({ text, index: start + lead })
  }
  for (const m of flat.matchAll(/(?<=[.!?])\s+(?=[A-Z"“(])/g)) {
    push(m.index ?? 0)
    start = (m.index ?? 0) + m[0].length
  }
  push(flat.length)
  return out
}

/**
 * Read the pages for a deadline sentence, a "not out yet" sentence, or a
 * rolling statement. Dated beats not-public beats rolling, and only a dated
 * sentence that is in the future (relative to `today`) counts as a deadline;
 * a past one is returned as `past`, so a caller can still show it as a past
 * cycle. A deadline with no year is `recurring`, below not-public.
 *
 * `ctx.programName` is what rules out a date in another fund's section; with
 * no name that rule is off, the others still hold.
 */
export function findDeadlineProof(
  pages: Array<{ url: string; text: string }>,
  today = new Date().toISOString().slice(0, 10),
  ctx: ProofContext = {},
): DeadlineProof & { past?: { date: string; quote: string; url: string } } {
  const checkedAt = new Date().toISOString()
  const urlsRead = pages.map((p) => p.url)
  // A grant-finder's page or an archive copy is read (it is in urlsRead) but
  // never evidence: grantable.co's "Deadline January 26, 2027" was its own
  // projection from the funder's 2026 date.
  const own = pages.filter((p) => !isThirdPartyGrantUrl(p.url))
  let notPublic: { quote: string; url: string } | null = null
  let rolling: { quote: string; url: string } | null = null
  let past: { date: string; quote: string; url: string } | null = null
  let recurring: { monthDay: string; quote: string; url: string; mentions?: boolean } | null = null
  let firstDated: { date: string; quote: string; url: string; mentions: boolean } | null = null
  const layouts = own.map((p) => ({ url: p.url, page: layout(p.text) }))
  for (const { url, page } of layouts) {
    const hits: Array<{ date: string; quote: string; url: string; mentions: boolean }> = []
    let pageRecurring: { monthDay: string; quote: string; url: string; mentions: boolean } | null = null
    let pageNotPublic: { quote: string; url: string; mentions: boolean } | null = null
    let pageRolling: { quote: string; url: string; mentions: boolean } | null = null
    for (const { text: s, index: at } of sentences(page.flat)) {
      if (FURNITURE_RE.test(s)) continue
      if (OTHER_DEADLINE_RE.test(s)) continue
      const dm = dateForCue(s)
      if (dm && DEADLINE_CUE.test(s)) {
        const di = dm.index ?? 0
        const prev = [...s.matchAll(new RegExp(DATE_RE.source, 'gi'))].filter((d) => (d.index ?? 0) < di).pop()
        const prevEnd = prev ? (prev.index ?? 0) + prev[0].length : 0
        const iso = isoFromMatch(dm)
        if (
          iso &&
          /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso) &&
          tiedToApplying(leadOf(s, di, prevEnd)) &&
          !belongsElsewhere(page, at + di, ctx)
        ) {
          hits.push({ date: iso, quote: s.slice(0, 220), url, mentions: mentionsUs(page.flat, at, at + di, ctx) })
        }
      } else if (!dm && DEADLINE_CUE.test(s) && !/\b20\d\d\b/.test(s)) {
        // No year anywhere in the sentence: the pattern, not a round. A
        // sentence that names a year apart from the date ("the next cycle
        // (2026) are due April 30") is too stale or too odd to lean on.
        const md = monthDayFromYearless(s)
        const mi = s.match(DATE_NO_YEAR_RE)?.index ?? -1
        if (md && mi >= 0 && !pageRecurring && tiedToApplying(leadOf(s, mi, 0)) && !belongsElsewhere(page, at + mi, ctx)) pageRecurring = { monthDay: md, quote: s.slice(0, 220), url, mentions: mentionsUs(page.flat, at, at + mi, ctx) }
      }
      if (!pageNotPublic && NOT_PUBLIC_RE.test(s)) pageNotPublic = { quote: s.slice(0, 220), url, mentions: mentionsUs(page.flat, at, at + s.length, ctx) }
      if (!pageRolling && ROLLING_RE.test(s)) pageRolling = { quote: s.slice(0, 220), url, mentions: mentionsUs(page.flat, at, at + s.length, ctx) }
    }
    // On a page with several sponsors' grants and no headings to tell them
    // apart (firstinspires.org/robotics/team-grants), once any dated passage
    // names this programme or funder, only those passages count on the page:
    // the others are the other sponsors'.
    // On a page that lists several other programmes, a date whose passage
    // does not name this one is somebody else's: Boston Scientific's block
    // on FIRST's team-grants page has no date, and 3M's is two blocks down.
    const multi = listsOtherProgrammes(page.flat, ctx)
    const ours = hits.some((h) => h.mentions) || multi ? hits.filter((h) => h.mentions) : hits
    // Timing words on such a page are the same: "reviewed on a rolling
    // basis" on FIRST's page is 3M's, not Boston Scientific's.
    if (pageRecurring && (!multi || pageRecurring.mentions) && !recurring) recurring = pageRecurring
    if (pageNotPublic && (!multi || pageNotPublic.mentions) && !notPublic) notPublic = pageNotPublic
    if (pageRolling && (!multi || pageRolling.mentions) && !rolling) rolling = pageRolling
    const next = ours.find((h) => h.date >= today)
    if (next && (!firstDated || (next.mentions && !firstDated.mentions))) firstDated = next
    for (const h of ours) if (h.date < today && (!past || h.date > past.date)) past = { date: h.date, quote: h.quote, url: h.url }
  }
  if (firstDated) return { kind: 'dated', date: firstDated.date, quote: firstDated.quote, url: firstDated.url, urlsRead, checkedAt, ...(past ? { past } : {}) }
  // A window names both ends in the funder's words.
  for (const { url, page } of layouts) {
    const wins = windowsInFlat(page.flat, today).filter((w) => !belongsElsewhere(page, w.index, ctx))
    const next = wins.find((w) => w.date >= today)
    if (next) return { kind: 'dated', date: next.date, opens: next.opens, quote: next.quote, url, urlsRead, checkedAt, ...(past ? { past } : {}) }
    const last = wins.filter((w) => w.date < today).pop()
    if (last && (!past || last.date > past.date)) past = { date: last.date, quote: last.quote, url }
  }
  if (notPublic) return { kind: 'not_public', quote: notPublic.quote, url: notPublic.url, urlsRead, checkedAt, ...(past ? { past } : {}) }
  if (recurring) return { kind: 'recurring', monthDay: recurring.monthDay, quote: recurring.quote, url: recurring.url, urlsRead, checkedAt, ...(past ? { past } : {}) }
  if (rolling) return { kind: 'rolling', quote: rolling.quote, url: rolling.url, urlsRead, checkedAt, ...(past ? { past } : {}) }
  return { kind: 'none', urlsRead, checkedAt, ...(past ? { past } : {}) }
}
