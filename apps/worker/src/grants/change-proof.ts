/**
 * Which monitor changes are PROVEN, and so may be applied without a person.
 *
 * The change queue exists because a scraped date is a guess until someone has
 * read the funder's page. Most pending rows are not guesses, though: the page
 * says "Applications are due March 1, 2027" and the row says 2027-03-01. A
 * person applying that row adds nothing but a click. This file is the test for
 * "the page already says it", run twice: once by the monitor when it files the
 * row, once by scripts/apply-proven-grant-changes.ts over the backlog.
 *
 * PROVEN means all of:
 *
 *   1. The field is on the allowlist: cycle.<year>.{deadlineAt, opensAt,
 *      decisionAt, deadlineNote, status} or awardMin / awardMax / awardNotes /
 *      awardCurrency. Name, summary, description, eligibility, URLs, programs
 *      and geography are never auto-applied, whatever the page says.
 *   2. No guard trips: the new value is not empty (a change never clears a
 *      field by itself), a deadline does not move more than 60 days EARLIER,
 *      an award does not change by more than 5x either way, a cycle date
 *      belongs to its cycle's year, and the page was not read off the
 *      Wayback Machine (an archive copy is last year's page).
 *   3. A verbatim quote from the snapshot's own page text supports the value,
 *      read deterministically here, not by the model that proposed it. Two
 *      readers agreeing is the point: the extractor proposed the value, this
 *      finds the funder's words for it or refuses.
 *
 * "Verbatim" means a substring of the page text after collapsing whitespace.
 * Dates must be written with their year: "due November 15" is not proof of
 * which November.
 *
 * Pure: no database, no network. The caller supplies the text.
 */
import type { ExtractedGrantFields } from '@the-tool-pit/db'
import { deriveCycleStatus } from './cadence.js'
import { easternDay } from './change-filters.js'
import { DATE_RE, DEADLINE_CUE, OTHER_DEADLINE_RE, isoFromMatch, windowsIn } from './deadline-proof.js'

// #region rule

export const AUTO_CYCLE_COLUMNS: ReadonlySet<string> = new Set(['deadlineAt', 'opensAt', 'decisionAt', 'deadlineNote', 'status'])
export const AUTO_GRANT_FIELDS: ReadonlySet<string> = new Set(['awardMin', 'awardMax', 'awardNotes', 'awardCurrency'])

/** A deadline pulled forward by more than this is a misread, or news big enough for a person. */
export const MAX_EARLIER_DEADLINE_DAYS = 60
/** An award that grows or shrinks by more than this factor is a misread (a total, a typo) until a person says not. */
export const MAX_AWARD_FACTOR = 5

/** Quotes longer than this are cut; the reviewer opens the snapshot for the rest. */
const QUOTE_LIMIT = 300

export interface ChangeUnderTest {
  field: string
  oldValue: unknown
  newValue: unknown
}

export interface ProofContext {
  /** The snapshot's stripped page text (grant_snapshots.content_text). */
  pageText: string
  /** Where the text was read from. An archive.org URL is never proof. */
  pageUrl?: string | null
  /** The snapshot's extracted fields. Only a derived status needs these. */
  extracted?: ExtractedGrantFields | null
  now?: Date
}

export type ProofVerdict = { proven: true; quote: string } | { proven: false; reason: string }

const no = (reason: string): ProofVerdict => ({ proven: false, reason })

export function proveChange(change: ChangeUnderTest, ctx: ProofContext): ProofVerdict {
  const now = ctx.now ?? new Date()
  const parsed = parseField(change.field)
  if (!parsed) return no(`${change.field} is not on the auto-apply allowlist`)

  if (isEmpty(change.newValue)) return no('the change would clear the value')
  if (ctx.pageUrl && /(^|\/\/|\.)web\.archive\.org\//i.test(ctx.pageUrl)) return no('page read from an archive copy')

  const flat = ctx.pageText.replace(/\s+/g, ' ').trim()
  if (!flat) return no('no page text on the snapshot')

  if (parsed.kind === 'cycle') {
    const { year, column } = parsed
    switch (column) {
      case 'deadlineAt': {
        const next = readInstant(change.newValue)
        if (!next) return no('new deadline does not parse')
        const old = readInstant(change.oldValue)
        if (old && old.ms - next.ms > MAX_EARLIER_DEADLINE_DAYS * 86_400_000) {
          return no(`deadline moves more than ${MAX_EARLIER_DEADLINE_DAYS} days earlier`)
        }
        if (Number(next.day.slice(0, 4)) !== year) return no(`deadline ${next.day} is not in the ${year} cycle`)
        return proveDate(flat, 'deadline', next.day, next.time)
      }
      case 'opensAt':
      case 'decisionAt': {
        const day = readDay(change.newValue)
        if (!day) return no(`new ${column} is not a YYYY-MM-DD date`)
        const y = Number(day.slice(0, 4))
        if (column === 'opensAt' && (y < year - 1 || y > year)) return no(`opening ${day} is not in the ${year} cycle`)
        if (column === 'decisionAt' && (y < year || y > year + 1)) return no(`decision ${day} is not in the ${year} cycle`)
        return proveDate(flat, column === 'opensAt' ? 'opens' : 'decision', day, null)
      }
      case 'deadlineNote':
        return proveVerbatim(flat, change.newValue)
      case 'status':
        return proveStatus(flat, change.newValue, ctx.extracted ?? null, year, now)
    }
    return no(`${change.field} has no proof rule`)
  }

  switch (parsed.field) {
    case 'awardMin':
    case 'awardMax': {
      const next = typeof change.newValue === 'number' ? change.newValue : Number(change.newValue)
      if (!Number.isFinite(next) || next <= 0) return no('new award is not a positive number')
      const old = typeof change.oldValue === 'number' ? change.oldValue : change.oldValue == null ? null : Number(change.oldValue)
      if (old !== null && Number.isFinite(old) && old > 0 && Math.max(next / old, old / next) > MAX_AWARD_FACTOR) {
        return no(`award changes by more than ${MAX_AWARD_FACTOR}x`)
      }
      return proveAmount(flat, parsed.field === 'awardMax' ? 'max' : 'min', Math.round(next))
    }
    case 'awardNotes':
      return proveVerbatim(flat, change.newValue)
    case 'awardCurrency':
      return proveCurrency(flat, change.newValue)
  }
  return no(`${change.field} has no proof rule`)
}

/** The reasoning text to store on a proven row: the quote first, so a 1000-char cut never loses it. */
export function reasoningWithProof(reasoning: string | null | undefined, quote: string): string {
  return [`Proof on the funder's page: "${quote}"`, reasoning ?? ''].filter(Boolean).join('\n')
}

// #endregion

// #region field paths and values

type ParsedField = { kind: 'cycle'; year: number; column: string } | { kind: 'grant'; field: string }

function parseField(field: string): ParsedField | null {
  const parts = field.split('.')
  if (parts[0] === 'cycle') {
    if (parts.length !== 3) return null
    const year = Number(parts[1])
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return null
    return AUTO_CYCLE_COLUMNS.has(parts[2]) ? { kind: 'cycle', year, column: parts[2] } : null
  }
  return parts.length === 1 && AUTO_GRANT_FIELDS.has(field) ? { kind: 'grant', field } : null
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

function readDay(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, 10)
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) ? s : null
}

/**
 * A stored or proposed deadline as the calendar day it names and, when the
 * value carries one, the clock time written on the page (minutes past
 * midnight). UTC midnight is the monitor's "date only" form (monitor.ts
 * toDeadlineDate), so it carries no time. An explicit offset keeps the local
 * date and time as written; a bare Z instant is read in US Eastern, the zone
 * change-filters.ts reads these pages in.
 */
function readInstant(v: unknown): { day: string; time: number | null; ms: number } | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const s = v.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { day: s, time: null, ms: Date.parse(`${s}T00:00:00Z`) }
  const ms = Date.parse(s)
  if (Number.isNaN(ms)) return null
  if (/T00:00(:00(\.0+)?)?Z$/.test(s)) return { day: s.slice(0, 10), time: null, ms }
  const local = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?[+-]\d{2}:?\d{2}$/)
  if (local) return { day: local[1], time: Number(local[2]) * 60 + Number(local[3]), ms }
  const d = new Date(ms)
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
  const [h, m] = hm.split(':').map(Number)
  return { day: easternDay(d), time: h * 60 + m, ms }
}

// #endregion

// #region quotes

/** Cut [start, end) out of the text with some context, snapped to word edges. Always a substring of `flat`. */
function snippet(flat: string, start: number, end: number, pad = 60): string {
  let a = Math.max(0, start - pad)
  let b = Math.min(flat.length, end + pad)
  if (a > 0) {
    const sp = flat.indexOf(' ', a)
    if (sp !== -1 && sp < start) a = sp + 1
  }
  if (b < flat.length) {
    const sp = flat.lastIndexOf(' ', b)
    if (sp >= end) b = sp
  }
  const out = flat.slice(a, b).trim()
  if (out.length <= QUOTE_LIMIT) return out
  // Keep the evidence itself when the padding is what overflowed.
  return flat.slice(start, Math.min(end, start + QUOTE_LIMIT)).trim()
}

function proveVerbatim(flat: string, value: unknown): ProofVerdict {
  if (typeof value !== 'string') return no('value is not text')
  const needle = value.replace(/\s+/g, ' ').trim()
  if (needle.length < 12) return no('text too short to prove')
  const bare = needle.replace(/[.;,]+$/, '')
  if (flat.includes(needle) || (bare.length >= 12 && flat.includes(bare))) {
    return { proven: true, quote: needle.length <= QUOTE_LIMIT ? needle : needle.slice(0, QUOTE_LIMIT) }
  }
  return no('text is not verbatim on the page')
}

// #endregion

// #region dates

type DateKind = 'deadline' | 'opens' | 'decision'

const CUES: Array<{ kind: DateKind; re: RegExp }> = [
  // DEADLINE_CUE has no leading \b ("disclosed" would read as "closed").
  { kind: 'deadline', re: new RegExp(`\\b(?:${DEADLINE_CUE.source})`, 'gi') },
  {
    kind: 'opens',
    re: /\b(opens?|opening( date)?|open(ed)? on|begins?|beginning|starts?|start date|available (on|starting|beginning)|accepting (applications|submissions|requests) (on|starting|beginning)|launch(es)?)\b/gi,
  },
  {
    kind: 'decision',
    re: /\b(notif(y|ied|ication|ications)|decisions?|announce(d|ment|ments)?|recipients (will be )?(notified|announced|selected)|awards? (will be )?(made|announced))\b/gi,
  },
]

/** How far past a cue word its date may sit. dateForCue in deadline-proof.ts uses the same reach. */
const CUE_REACH = 90

interface Span { index: number; end: number }

/**
 * The page states `day` as a date of this kind: some cue of that kind is the
 * nearest cue before the date, within CUE_REACH, with no other date between
 * them, and the passage is not about a scholarship, a report or a webinar.
 * A window ("Application period: 5/18/2026 - 6/29/2026") proves both ends.
 * When `time` is set the passage must also state that clock time.
 */
function proveDate(flat: string, kind: DateKind, day: string, time: number | null): ProofVerdict {
  const dates = [...flat.matchAll(new RegExp(DATE_RE.source, 'gi'))].map((m) => ({ iso: isoFromMatch(m), index: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
  const cues: Array<Span & { kind: DateKind }> = []
  for (const c of CUES) for (const m of flat.matchAll(c.re)) cues.push({ kind: c.kind, index: m.index ?? 0, end: (m.index ?? 0) + m[0].length })

  for (const d of dates) {
    if (d.iso !== day) continue
    const before = cues.filter((c) => c.end <= d.index && d.index - c.end <= CUE_REACH)
    if (before.length === 0) continue
    const nearest = before.reduce((a, b) => (b.end > a.end || (b.end === a.end && b.index < a.index) ? b : a))
    if (nearest.kind !== kind) continue
    if (dates.some((o) => o !== d && o.index >= nearest.end && o.index < d.index)) continue
    const span = flat.slice(Math.max(0, nearest.index - 60), d.end + 20)
    if (OTHER_DEADLINE_RE.test(span)) continue
    if (time !== null && !statesTime(flat.slice(Math.max(0, d.index - 120), d.end + 120), time)) continue
    return { proven: true, quote: snippet(flat, nearest.index, d.end) }
  }

  if (kind !== 'decision' && time === null) {
    for (const w of windowsIn(flat, day)) {
      if ((kind === 'deadline' ? w.date : w.opens) !== day) continue
      if (OTHER_DEADLINE_RE.test(w.quote)) continue
      if (flat.includes(w.quote)) return { proven: true, quote: w.quote.slice(0, QUOTE_LIMIT) }
    }
  }

  return no(`no ${kind} sentence on the page states ${day}${time !== null ? ' at that time' : ''}`)
}

/** Does the passage write this clock time (minutes past midnight)? "5 pm", "5:00 p.m.", "17:00", "midnight". */
function statesTime(passage: string, minutes: number): boolean {
  for (const m of passage.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s?(a\.?m\.?|p\.?m\.?)(?![a-z])|\b(noon|midnight)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi)) {
    if (m[4]) {
      const w = m[4].toLowerCase()
      if (w === 'noon' && minutes === 720) return true
      if (w === 'midnight' && (minutes === 0 || minutes === 1439)) return true
      continue
    }
    if (m[1]) {
      let h = Number(m[1]) % 12
      if (/^p/i.test(m[3])) h += 12
      if (h * 60 + Number(m[2] ?? 0) === minutes) return true
      continue
    }
    if (Number(m[5]) * 60 + Number(m[6]) === minutes) return true
  }
  return false
}

// #endregion

// #region status

const CLOSED_RE =
  /\b(?:(?:applications?|submissions?|requests?|the (?:grant|program|programme|round|cycle|portal|form|application period))\b[^.]{0,60}?\b(?:is|are|has|have) (?:now |currently )?(?:been )?(?:closed|no longer (?:being )?accepted)|no longer accepting (?:applications|submissions|requests|proposals)|not (?:currently )?accepting (?:applications|submissions|requests|proposals)|(?:applications?|grant cycle|round|portal|application period) (?:is |are |has |have )?(?:now )?closed)\b/i

/**
 * A status is proven two ways. "closed" by the funder saying so. "open" and
 * "upcoming" are derived from dates, so they are proven when the dates they
 * derive from are proven on the same page and still derive the same status
 * now: the page's deadline for this cycle, and its opening date when it gave
 * one (an unproven opening date could hide an "upcoming").
 */
function proveStatus(flat: string, value: unknown, extracted: ExtractedGrantFields | null, year: number, now: Date): ProofVerdict {
  if (value === 'closed') {
    const m = flat.match(CLOSED_RE)
    if (!m) return no('page does not say the round is closed')
    return { proven: true, quote: snippet(flat, m.index ?? 0, (m.index ?? 0) + m[0].length) }
  }
  if (value !== 'open' && value !== 'upcoming') return no(`status "${String(value)}" is never auto-applied`)

  const deadline = readInstant(extracted?.deadlineAt ?? null)
  if (!deadline) return no('status derives from a deadline the snapshot does not hold')
  if (Number(deadline.day.slice(0, 4)) !== year) return no(`page deadline ${deadline.day} is not in the ${year} cycle`)
  const deadlineProof = proveDate(flat, 'deadline', deadline.day, deadline.time)
  if (!deadlineProof.proven) return no(`status derives from an unproven deadline: ${deadlineProof.reason}`)

  const opens = readDay(extracted?.opensAt ?? null)
  const quotes = [deadlineProof.quote]
  if (opens) {
    const opensProof = proveDate(flat, 'opens', opens, null)
    if (!opensProof.proven) return no(`status derives from an unproven opening date: ${opensProof.reason}`)
    if (opensProof.quote !== deadlineProof.quote) quotes.push(opensProof.quote)
  }
  const deadlineAt = new Date(deadline.time === null ? `${deadline.day}T00:00:00Z` : deadline.ms)
  const derived = deriveCycleStatus(opens, deadlineAt, now)
  if (derived !== value) return no(`the proven dates now derive "${derived}", not "${value}"`)
  return { proven: true, quote: quotes.join(' … ').slice(0, QUOTE_LIMIT) }
}

// #endregion

// #region amounts

const MONEY_RE =
  /(?:US\s?|CA|AU|C|A)?[$€£]\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?(?:\s?(k|K|thousand|million|M|MM)\b)?|\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?\s?(USD|CAD|EUR|GBP|AUD|dollars)\b/g
const RANGE_JOIN_RE = /^\s*(?:-|–|—|to|and|through)\s*$/i
const OPEN_RANGE_AFTER_RE = /^\s*(?:-|–|—|to)\s*\d/
const AWARD_CUE_RE = /\b(grants?|awards?|awarded|funding|fund|up to|maximum|minimum|max|min|range|ranging|between|request(s|ed)?|amounts?|stipends?|sponsorships?|donations?|support of)\b/i
const MAX_CUE_RE = /\b(up to|maximum|max\.?|not (to )?exceed|no more than|as much as|at most|cap(ped)? at)\s*$/i
const MIN_CUE_RE = /\b(minimum|min\.?|at least|starting at|no less than|from)\s*$/i
/** An amount described as a total, a pool or a history is not the size of one award. */
const AGGREGATE_RE = /\b(total(ing|s)?|in total|pool|since (19|20)\d\d|last year|to date|(has|have) (awarded|given|donated|invested|distributed)|budget|revenue|raised|endowment|assets)\b/i

function moneyValue(m: RegExpMatchArray): number | null {
  const digits = (m[1] ?? m[3] ?? '').replace(/,/g, '')
  if (!digits) return null
  let n = Number(digits)
  const unit = (m[2] ?? '').toLowerCase()
  if (unit === 'k' || unit === 'thousand') n *= 1_000
  if (unit === 'million' || unit === 'm' || unit === 'mm') n *= 1_000_000
  return Number.isFinite(n) ? n : null
}

/**
 * The page states `value` as the maximum (or minimum) of one award. The upper
 * end of a range proves a maximum, the lower end a minimum; a single amount
 * proves either unless the words just before it say the other ("up to $5,000"
 * is not a minimum). The passage must be about an award and not a total.
 */
function proveAmount(flat: string, role: 'min' | 'max', value: number): ProofVerdict {
  const all = [...flat.matchAll(MONEY_RE)].map((m) => ({ n: moneyValue(m), index: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
  for (let i = 0; i < all.length; i++) {
    const a = all[i]
    if (a.n !== value) continue
    const prev = all[i - 1]
    const next = all[i + 1]
    const isUpper = Boolean(prev && RANGE_JOIN_RE.test(flat.slice(prev.end, a.index)))
    const isLower = Boolean((next && RANGE_JOIN_RE.test(flat.slice(a.end, next.index))) || OPEN_RANGE_AFTER_RE.test(flat.slice(a.end, a.end + 12)))
    const lead = flat.slice(Math.max(0, a.index - 30), a.index)
    if (role === 'max') {
      if (isLower) continue
      if (!isUpper && MIN_CUE_RE.test(lead)) continue
    } else {
      if (isUpper) continue
      if (!isLower && MAX_CUE_RE.test(lead)) continue
    }
    const around = flat.slice(Math.max(0, a.index - 100), a.end + 60)
    if (!AWARD_CUE_RE.test(around)) continue
    if (AGGREGATE_RE.test(flat.slice(Math.max(0, a.index - 100), a.end + 30))) continue
    const start = isUpper && prev ? prev.index : a.index
    const end = isLower && next ? next.end : a.end
    return { proven: true, quote: snippet(flat, start, end) }
  }
  return no(`page does not state ${value} as the award ${role === 'max' ? 'maximum' : 'minimum'}`)
}

const CURRENCY_MARKS: Record<string, string[]> = {
  USD: ['US$', 'USD'],
  CAD: ['C$', 'CA$', 'CAD'],
  AUD: ['A$', 'AU$', 'AUD'],
  EUR: ['€', 'EUR'],
  GBP: ['£', 'GBP'],
}

function proveCurrency(flat: string, value: unknown): ProofVerdict {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value.trim())) return no('currency is not a three-letter code')
  const code = value.trim()
  for (const mark of CURRENCY_MARKS[code] ?? [code]) {
    const re = /^[A-Z]+$/.test(mark) ? new RegExp(`\\b${mark}\\b`) : new RegExp(`(?<![A-Z])${mark.replace(/[$]/g, '\\$')}`)
    const m = flat.match(re)
    if (m) return { proven: true, quote: snippet(flat, m.index ?? 0, (m.index ?? 0) + m[0].length, 50) }
  }
  return no(`page does not name ${code}`)
}

// #endregion
