/**
 * Grant field extraction for the monitor pass.
 *
 * Deterministic first, AI only when the cheap read cannot decide, and never at
 * all when the content hash did not move. The Anthropic account is
 * pay-as-you-go and has run dry before, so a monitor that spends a model call
 * per grant per pass is a monitor that stops working on the day it matters.
 *
 * The output is only ever a PROPOSAL. Nothing here writes to a published
 * grant; monitor.ts turns these fields into grant_changes rows for a human.
 * That is why "no opinion" and "explicitly none" are kept apart:
 *
 *   undefined - the page does not talk about this field, do not diff it.
 *   null      - the page says there is no such value (rolling, no deadline).
 *
 * Collapsing those two would file a "deadline removed" change every time a
 * funder reworded a paragraph that never mentioned dates.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { ExtractedGrantFields } from '@the-tool-pit/db'

/** Cheapest model that reliably returns clean JSON. Same one classify.ts uses. */
const EXTRACT_MODEL = 'claude-haiku-4-5-20251001'

/**
 * How much stripped text the model sees. A funder page is usually well under
 * this; the cases that overflow are aggregator pages listing many programmes,
 * and truncating those is reported in `notes` rather than swallowed.
 */
const AI_TEXT_LIMIT = 12_000

/**
 * After a credit-balance failure, stop trying for this long. Without it a pass
 * over 300 grants makes 300 doomed API calls and buries the one log line that
 * says why nothing extracted.
 */
const CREDIT_COOLDOWN_MS = 30 * 60 * 1000

let creditExhaustedUntil = 0

// #region types

export interface GrantExtractionContext {
  /** The page the text came from, for the model's own context. */
  url: string
  grantName?: string
  /** GRANT_DEADLINE_TYPES. 'rolling' pages genuinely have no date to find. */
  deadlineType?: string | null
  /** What we currently believe, so the model can say "unchanged" not "re-guess". */
  currentDeadlineIso?: string | null
  currentAwardMin?: number | null
  currentAwardMax?: number | null
}

export interface GrantExtractionResult {
  fields: ExtractedGrantFields
  /** Which pass produced `fields`. 'none' means we deliberately extracted nothing. */
  source: 'deterministic' | 'ai' | 'none'
  /** 0-1. Below 0.4 the monitor should not file changes off it. */
  confidence: number
  reasoning: string
  /**
   * Anything that bounded this extraction: text truncated, AI skipped, budget
   * gone. Surfaced on the job result and logged, never dropped quietly.
   */
  notes: string[]
  aiCalled: boolean
  /** True when we wanted the AI pass and could not have it (credit, no key). */
  degraded: boolean
}

// #endregion

// #region deterministic passes

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

const MONTH_ALT = Object.keys(MONTHS).join('|')

/** "January 15, 2027", "Jan. 15 2027", "January 15th, 2027". */
const DATE_MDY = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i')
/** "15 January 2027". */
const DATE_DMY = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})\\.?,?\\s+(\\d{4})\\b`, 'i')
/** "2027-01-15". */
const DATE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/
/**
 * "1/15/2027". Read as month/day/year. Every grant in the seed set is North
 * American and quotes US order; a European funder would need a per-grant
 * setting, and until one exists this is the honest default to write down.
 */
const DATE_SLASH = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/

/** Phrases that introduce a closing date. Order does not matter, all are scanned. */
const DEADLINE_CUES = [
  'application deadline',
  'applications deadline',
  'submission deadline',
  'deadline to apply',
  'deadline for applications',
  'deadline',
  'applications are due',
  'applications due',
  'application due',
  'due date',
  'due by',
  'due no later than',
  'apply by',
  'submit by',
  'submitted by',
  'must be received by',
  'received no later than',
  'no later than',
  'postmarked by',
  'closes on',
  'closes',
  'closing date',
  'applications close',
  'application period ends',
  'accepted until',
  'open until',
]

/** Phrases that introduce an opening date. */
const OPENS_CUES = [
  'applications open',
  'application period opens',
  'application period begins',
  'applications will open',
  'opens on',
  'accepting applications beginning',
  'accepting applications starting',
]

/** Wording that means this round is shut. */
const CLOSED_CUES = [
  /applications?\s+(?:are\s+|is\s+)?(?:now\s+)?closed/i,
  /no longer accepting applications/i,
  /not currently accepting applications/i,
  /the deadline has passed/i,
  /this (?:round|cycle|programme|program) (?:is|has) closed/i,
  /closed for the \d{4}/i,
  /applications? for \d{4} (?:are|is) closed/i,
]

/** US eastern/central/mountain/pacific offsets, standard and daylight. */
const ZONE_OFFSETS: Record<string, { std: number; dst: number | null }> = {
  et: { std: -5, dst: -4 },
  est: { std: -5, dst: null },
  edt: { std: -4, dst: null },
  ct: { std: -6, dst: -5 },
  cst: { std: -6, dst: null },
  cdt: { std: -5, dst: null },
  mt: { std: -7, dst: -6 },
  mst: { std: -7, dst: null },
  mdt: { std: -6, dst: null },
  pt: { std: -8, dst: -7 },
  pst: { std: -8, dst: null },
  pdt: { std: -7, dst: null },
  utc: { std: 0, dst: null },
  gmt: { std: 0, dst: null },
}

/**
 * US daylight saving: second Sunday in March to first Sunday in November.
 * Needed because "11:59 pm ET" is an hour apart either side of the switch, and
 * a deadline that appears to move by an hour would file a change every March.
 */
function isUsDaylightSaving(year: number, month: number, day: number): boolean {
  const marchSecondSunday = nthSunday(year, 3, 2)
  const novemberFirstSunday = nthSunday(year, 11, 1)
  const value = month * 100 + day
  return value >= 300 + marchSecondSunday && value < 1100 + novemberFirstSunday
}

function nthSunday(year: number, month: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const firstSunday = 1 + ((7 - firstDow) % 7)
  return firstSunday + (n - 1) * 7
}

interface LooseDate {
  year: number
  month: number
  day: number
}

function validDate(year: number, month: number, day: number): LooseDate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // Reject dates far outside the plausible grant window. A page footer full of
  // "© 1998" should never become a deadline.
  const thisYear = new Date().getUTCFullYear()
  if (year < thisYear - 2 || year > thisYear + 4) return null
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return { year, month, day }
}

/** Parse the first date in a fragment, trying each supported shape. Exported for tests. */
export function parseLooseDate(fragment: string): LooseDate | null {
  const mdy = fragment.match(DATE_MDY)
  if (mdy) {
    const month = MONTHS[mdy[1].toLowerCase()]
    return validDate(parseInt(mdy[3], 10), month, parseInt(mdy[2], 10))
  }
  const dmy = fragment.match(DATE_DMY)
  if (dmy) {
    const month = MONTHS[dmy[2].toLowerCase()]
    return validDate(parseInt(dmy[3], 10), month, parseInt(dmy[1], 10))
  }
  const iso = fragment.match(DATE_ISO)
  if (iso) {
    return validDate(parseInt(iso[1], 10), parseInt(iso[2], 10), parseInt(iso[3], 10))
  }
  const slash = fragment.match(DATE_SLASH)
  if (slash) {
    const rawYear = parseInt(slash[3], 10)
    const year = rawYear < 100 ? 2000 + rawYear : rawYear
    return validDate(year, parseInt(slash[1], 10), parseInt(slash[2], 10))
  }
  return null
}

/**
 * Read a clock time and named US timezone out of a fragment. Returns null when
 * there is no zone: a bare "5pm" is ambiguous and we would rather store a
 * date-only deadline than a confidently wrong instant.
 */
function parseTimeWithZone(fragment: string, date: LooseDate): { iso: string; note: string } | null {
  const match = fragment.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?\s*\(?([a-z]{2,4})\)?/i,
  )
  if (!match) return null
  const zone = ZONE_OFFSETS[match[4].toLowerCase()]
  if (!zone) return null

  let hour = parseInt(match[1], 10) % 12
  if (match[3].toLowerCase() === 'p') hour += 12
  const minute = match[2] ? parseInt(match[2], 10) : 0
  if (hour > 23 || minute > 59) return null

  const offset = zone.dst !== null && isUsDaylightSaving(date.year, date.month, date.day) ? zone.dst : zone.std
  const utc = Date.UTC(date.year, date.month - 1, date.day, hour - offset, minute)
  return { iso: new Date(utc).toISOString(), note: match[0].trim() }
}

function isoDateOnly(date: LooseDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

interface CueHit {
  /** ISO instant when a time and zone were stated, otherwise YYYY-MM-DD. */
  value: string
  date: LooseDate
  /** The sentence it came from, for grant_changes.reasoning. */
  snippet: string
}

/**
 * Find dates that sit next to one of `cues`. The window runs a little before
 * the cue and well after it, because both "due: 15 January 2027" and
 * "15 January 2027 is the deadline" are common.
 */
function findCuedDates(text: string, cues: string[]): CueHit[] {
  const hits: CueHit[] = []
  const haystack = text.toLowerCase()

  for (const cue of cues) {
    let from = 0
    for (;;) {
      const at = haystack.indexOf(cue, from)
      if (at === -1) break
      from = at + cue.length

      const window = text.slice(Math.max(0, at - 60), Math.min(text.length, at + cue.length + 160))
      const date = parseLooseDate(window)
      if (!date) continue

      const withTime = parseTimeWithZone(window, date)
      hits.push({
        value: withTime ? withTime.iso : isoDateOnly(date),
        date,
        snippet: window.replace(/\s+/g, ' ').trim().slice(0, 220),
      })
    }
  }
  return hits
}

const AMOUNT_CONTEXT = /award|grant|funding|prize|receive|amount|maximum|up to|range|budget|stipend/i

function parseAmount(raw: string, suffix?: string): number | null {
  const base = parseFloat(raw.replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  const scale = suffix ? suffix.trim().toLowerCase() : ''
  const value = scale.startsWith('k') || scale.startsWith('thousand')
    ? base * 1000
    : scale.startsWith('m')
      ? base * 1_000_000
      : base
  // Anything past this is a capital campaign total or a typo, not a team grant.
  if (value < 50 || value > 5_000_000) return null
  return Math.round(value)
}

const MONEY = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d{2})?)\s*(k\b|thousand\b|million\b|m\b)?`
const RANGE_RE = new RegExp(`(?:between\\s+)?${MONEY}\\s*(?:-|–|—|to|and)\\s*${MONEY}`, 'i')
const UP_TO_RE = new RegExp(`(?:up to|as much as|maximum of|max of)\\s*${MONEY}`, 'i')
const MAX_SUFFIX_RE = new RegExp(`${MONEY}\\s*(?:maximum|max\\b|or less)`, 'i')
const MIN_RE = new RegExp(`(?:minimum of|starting at|at least)\\s*${MONEY}`, 'i')
const ANY_MONEY_RE = new RegExp(MONEY, 'gi')

interface MoneyRead {
  awardMin?: number | null
  awardMax?: number | null
  awardNotes?: string | null
}

/** Pull award sizes out of sentences that are actually about the award. */
function readAmounts(text: string): MoneyRead {
  // Only look at sentences that mention money AND an award-ish word, so a
  // "$25 registration fee" or a "$5,000 sponsorship of our gala" is ignored.
  const sentences = text
    .split(/(?<=[.!?])\s+|\n/)
    .filter((s) => s.includes('$') && AMOUNT_CONTEXT.test(s))

  for (const sentence of sentences) {
    const range = sentence.match(RANGE_RE)
    if (range) {
      const min = parseAmount(range[1], range[2])
      const max = parseAmount(range[3], range[4])
      if (min !== null && max !== null && min <= max) {
        return { awardMin: min, awardMax: max, awardNotes: sentence.trim().slice(0, 220) }
      }
    }
  }

  const out: MoneyRead = {}
  for (const sentence of sentences) {
    const upTo = sentence.match(UP_TO_RE) ?? sentence.match(MAX_SUFFIX_RE)
    if (upTo && out.awardMax === undefined) {
      const max = parseAmount(upTo[1], upTo[2])
      if (max !== null) {
        out.awardMax = max
        out.awardNotes = sentence.trim().slice(0, 220)
      }
    }
    const min = sentence.match(MIN_RE)
    if (min && out.awardMin === undefined) {
      const value = parseAmount(min[1], min[2])
      if (value !== null) out.awardMin = value
    }
  }
  if (out.awardMax !== undefined) return out

  // Last resort: exactly one distinct amount across all award sentences. More
  // than one and we cannot tell which is the award, so we say nothing.
  const distinct = new Set<number>()
  let noteSentence = ''
  for (const sentence of sentences) {
    for (const m of sentence.matchAll(ANY_MONEY_RE)) {
      const value = parseAmount(m[1], m[2])
      if (value !== null) {
        distinct.add(value)
        if (!noteSentence) noteSentence = sentence.trim().slice(0, 220)
      }
    }
  }
  if (distinct.size === 1) {
    const only = [...distinct][0]
    return { awardMax: only, awardNotes: noteSentence }
  }
  return out
}

const ELIGIBILITY_HEADING = /^(eligibility(?: requirements| criteria)?|who (?:can|may) apply|who is eligible|eligible applicants)\b[:\s]*$/i

/** Grab the prose under an "Eligibility" heading, if the page has one. */
function readEligibility(text: string): string | undefined {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!ELIGIBILITY_HEADING.test(lines[i].trim())) continue
    const body: string[] = []
    for (let j = i + 1; j < lines.length && body.length < 8; j++) {
      const line = lines[j].trim()
      if (!line) continue
      // A short line with no sentence punctuation is the next heading.
      if (body.length > 0 && line.length < 40 && !/[.,;:]/.test(line)) break
      body.push(line)
    }
    const joined = body.join(' ').trim()
    if (joined.length >= 30) return joined.slice(0, 1500)
  }
  return undefined
}

export interface DeterministicRead {
  fields: ExtractedGrantFields
  /** True when the cheap pass is trustworthy enough to skip the AI call. */
  confident: boolean
  reasoning: string
}

/**
 * The cheap pass. Regex only, no network, no spend. Confident means: exactly
 * one closing date survived the cues, or the page plainly says the round is
 * closed and offers no competing date.
 */
export function deterministicExtract(text: string): DeterministicRead {
  const fields: ExtractedGrantFields = {}
  const reasons: string[] = []

  const deadlineHits = findCuedDates(text, DEADLINE_CUES)
  const distinctDeadlines = [...new Set(deadlineHits.map((h) => h.value))]

  const closed = CLOSED_CUES.some((re) => re.test(text))
  if (closed) {
    fields.looksClosed = true
    reasons.push('page states the round is closed')
  }

  if (distinctDeadlines.length === 1) {
    const hit = deadlineHits.find((h) => h.value === distinctDeadlines[0])!
    fields.deadlineAt = hit.value
    fields.deadlineNote = hit.snippet
    fields.cycleYear = hit.date.year
    reasons.push(`one closing date found: ${hit.value}`)
  } else if (distinctDeadlines.length > 1) {
    reasons.push(`${distinctDeadlines.length} competing closing dates (${distinctDeadlines.join(', ')})`)
  } else {
    reasons.push('no cued closing date')
  }

  const opensHits = findCuedDates(text, OPENS_CUES)
  const distinctOpens = [...new Set(opensHits.map((h) => h.value))]
  if (distinctOpens.length === 1) {
    // opensAt is a DATE column, so drop any time part rather than inventing one.
    fields.opensAt = distinctOpens[0].slice(0, 10)
    if (fields.cycleYear === undefined) fields.cycleYear = opensHits[0].date.year
  }

  const money = readAmounts(text)
  if (money.awardMin !== undefined) fields.awardMin = money.awardMin
  if (money.awardMax !== undefined) fields.awardMax = money.awardMax
  if (money.awardNotes !== undefined) fields.awardNotes = money.awardNotes

  const eligibility = readEligibility(text)
  if (eligibility) fields.eligibilityText = eligibility

  const confident =
    distinctDeadlines.length === 1 || (closed && distinctDeadlines.length === 0)

  return { fields, confident, reasoning: reasons.join('; ') }
}

// #endregion

// #region AI fallback

let _client: Anthropic | undefined
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

/**
 * The one API failure we must survive gracefully. Anthropic returns a 400 with
 * "Your credit balance is too low to access the Anthropic API" when the
 * account runs out, and it will do that for every grant in the pass.
 */
export function isCreditExhaustedError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err ?? '')
  return /credit balance is too low|insufficient (?:credit|funds)/i.test(message)
}

const SYSTEM_PROMPT = `You read one funding page and report ONLY what it actually says.

A wrong deadline is worse than no deadline. This output is reviewed by a human before it
touches a public listing, so an honest "I do not know" costs nothing and a confident guess
costs a team a missed application.

Rules:
- Use null for any field the page does not state. NEVER carry a value over from the
  "currently on file" block, never infer this year's date from last year's, never round.
- deadlineAt: ISO 8601. Use a full instant with offset ONLY if the page gives a time and a
  named timezone (e.g. "2027-01-15T23:59:00-05:00"). Otherwise use "YYYY-MM-DD".
- opensAt: "YYYY-MM-DD" or null.
- cycleYear: the calendar year the round closes in, as an integer, or null.
- awardMin / awardMax: integers in the page's own currency, or null. "up to $5,000" means
  awardMax 5000 and awardMin null.
- awardNotes: the funder's own wording about the amount, one short quote, or null.
- eligibilityText: a short plain summary of who may apply, or null.
- applicationUrl: only a URL that literally appears in the text as the place to apply, else null.
- looksClosed: true only if the page says this round is not accepting applications now.
- confidence: 0.0-1.0, how sure you are the page states these values.
- reasoning: one sentence on where you read the deadline, or why you could not.

Return ONLY the JSON object, no markdown fences and no prose.`

function buildUserContent(text: string, ctx: GrantExtractionContext): string {
  const lines = [`URL: ${ctx.url}`]
  if (ctx.grantName) lines.push(`Grant: ${ctx.grantName}`)
  if (ctx.deadlineType) lines.push(`Deadline type on file: ${ctx.deadlineType}`)
  lines.push(
    'Currently on file (for context only, do not repeat it back unless the page says it):',
    `  deadline: ${ctx.currentDeadlineIso ?? 'none'}`,
    `  award: ${ctx.currentAwardMin ?? '?'} to ${ctx.currentAwardMax ?? '?'}`,
    '',
    'Page text:',
    text,
  )
  return lines.join('\n')
}

interface AiPayload extends ExtractedGrantFields {
  confidence?: number
  reasoning?: string
}

function clampYear(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  const now = new Date().getUTCFullYear()
  return value >= now - 2 && value <= now + 4 ? value : undefined
}

function clampAmount(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  return rounded >= 50 && rounded <= 5_000_000 ? rounded : undefined
}

/** Accept a date only if it parses and lands in the plausible window. */
function clampDate(value: unknown, dateOnly = false): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  const year = parsed.getUTCFullYear()
  const now = new Date().getUTCFullYear()
  if (year < now - 2 || year > now + 4) return undefined
  if (dateOnly) return parsed.toISOString().slice(0, 10)
  // Keep the model's own string when it was date-only; adding a fake midnight
  // would read as a precise time we do not have.
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : parsed.toISOString()
}

function clampText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function parseAiPayload(raw: string): AiPayload {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  return JSON.parse(fence ? fence[1].trim() : raw.trim()) as AiPayload
}

/** Keep only the fields the model is allowed to have an opinion on, validated. */
function validateAiFields(payload: AiPayload): ExtractedGrantFields {
  const out: ExtractedGrantFields = {}
  const deadline = clampDate(payload.deadlineAt)
  if (deadline !== undefined) out.deadlineAt = deadline
  const opens = clampDate(payload.opensAt, true)
  if (opens !== undefined) out.opensAt = opens
  const year = clampYear(payload.cycleYear)
  if (year !== undefined) out.cycleYear = year
  const min = clampAmount(payload.awardMin)
  if (min !== undefined) out.awardMin = min
  const max = clampAmount(payload.awardMax)
  if (max !== undefined) out.awardMax = max
  const note = clampText(payload.deadlineNote, 300)
  if (note !== undefined) out.deadlineNote = note
  const awardNotes = clampText(payload.awardNotes, 300)
  if (awardNotes !== undefined) out.awardNotes = awardNotes
  const eligibility = clampText(payload.eligibilityText, 1500)
  if (eligibility !== undefined) out.eligibilityText = eligibility
  const applicationUrl = clampText(payload.applicationUrl, 500)
  if (applicationUrl !== undefined && (applicationUrl === null || /^https?:\/\//i.test(applicationUrl))) {
    out.applicationUrl = applicationUrl
  }
  if (typeof payload.looksClosed === 'boolean') out.looksClosed = payload.looksClosed

  // A min above a max is a misread, not a range. Drop both rather than file a
  // change a reviewer has to unpick.
  if (typeof out.awardMin === 'number' && typeof out.awardMax === 'number' && out.awardMin > out.awardMax) {
    delete out.awardMin
    delete out.awardMax
  }
  return out
}

// #endregion

/**
 * Extract the fields the monitor diffs against. Call this ONLY when the
 * content hash moved: an unchanged page has nothing new to say and the whole
 * point of the hash is to not pay for that.
 */
export async function extractGrantFields(
  text: string,
  ctx: GrantExtractionContext,
): Promise<GrantExtractionResult> {
  const notes: string[] = []

  if (!text.trim()) {
    return {
      fields: {},
      source: 'none',
      confidence: 0,
      reasoning: 'no text to read',
      notes: ['stripped content was empty, nothing extracted'],
      aiCalled: false,
      degraded: false,
    }
  }

  const cheap = deterministicExtract(text)
  if (cheap.confident) {
    return {
      fields: cheap.fields,
      source: 'deterministic',
      confidence: 0.8,
      reasoning: cheap.reasoning,
      notes,
      aiCalled: false,
      degraded: false,
    }
  }

  // A rolling grant has no date to find, so an uncertain cheap pass on one is
  // the expected outcome and not worth a model call.
  if (ctx.deadlineType === 'rolling' && cheap.fields.looksClosed !== true) {
    notes.push('rolling grant, AI pass skipped (no deadline expected)')
    return {
      fields: cheap.fields,
      source: 'deterministic',
      confidence: 0.5,
      reasoning: `${cheap.reasoning}; rolling grant, AI skipped`,
      notes,
      aiCalled: false,
      degraded: false,
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    notes.push('ANTHROPIC_API_KEY not set, AI extraction unavailable this pass')
    console.warn('[grant-extract] ANTHROPIC_API_KEY not set - deterministic fields only')
    return {
      fields: cheap.fields,
      source: 'deterministic',
      confidence: 0.3,
      reasoning: cheap.reasoning,
      notes,
      aiCalled: false,
      degraded: true,
    }
  }

  if (Date.now() < creditExhaustedUntil) {
    const minutes = Math.ceil((creditExhaustedUntil - Date.now()) / 60_000)
    notes.push(`Anthropic credit exhausted, AI extraction paused for another ~${minutes} min`)
    console.warn(`[grant-extract] credit cooldown active, skipping AI for ${ctx.url}`)
    return {
      fields: {},
      source: 'none',
      confidence: 0,
      reasoning: 'AI extraction paused after a credit-balance failure',
      notes,
      aiCalled: false,
      degraded: true,
    }
  }

  let prompt = text
  if (prompt.length > AI_TEXT_LIMIT) {
    prompt = prompt.slice(0, AI_TEXT_LIMIT)
    notes.push(`page text truncated to ${AI_TEXT_LIMIT} chars for the AI pass (${text.length} total)`)
  }

  try {
    const response = await getClient().messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent(prompt, ctx) }],
    })
    const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!block) {
      notes.push('AI returned no text block')
      return {
        fields: cheap.fields,
        source: 'deterministic',
        confidence: 0.3,
        reasoning: cheap.reasoning,
        notes,
        aiCalled: true,
        degraded: false,
      }
    }

    let payload: AiPayload
    try {
      payload = parseAiPayload(block.text)
    } catch {
      console.error(`[grant-extract] JSON parse failed for ${ctx.url}: ${block.text.slice(0, 200)}`)
      notes.push('AI response was not valid JSON, deterministic fields only')
      return {
        fields: cheap.fields,
        source: 'deterministic',
        confidence: 0.3,
        reasoning: cheap.reasoning,
        notes,
        aiCalled: true,
        degraded: false,
      }
    }

    const confidence = typeof payload.confidence === 'number'
      ? Math.min(1, Math.max(0, payload.confidence))
      : 0.5
    const fields = validateAiFields(payload)

    return {
      fields,
      source: 'ai',
      confidence,
      reasoning: payload.reasoning?.slice(0, 500) ?? cheap.reasoning,
      notes,
      aiCalled: true,
      degraded: false,
    }
  } catch (err) {
    if (isCreditExhaustedError(err)) {
      creditExhaustedUntil = Date.now() + CREDIT_COOLDOWN_MS
      console.error(
        '[grant-extract] Anthropic credit balance exhausted. No extraction this pass; ' +
          `AI paused for ${CREDIT_COOLDOWN_MS / 60_000} min. Existing grant data is untouched.`,
      )
      notes.push('Anthropic credit balance exhausted, no extraction this pass')
      return {
        fields: {},
        source: 'none',
        confidence: 0,
        reasoning: 'Anthropic credit balance exhausted',
        notes,
        aiCalled: true,
        degraded: true,
      }
    }
    console.error(`[grant-extract] API error for ${ctx.url}:`, err)
    notes.push(`AI extraction failed: ${err instanceof Error ? err.message : String(err)}`)
    return {
      fields: cheap.fields,
      source: 'deterministic',
      confidence: 0.3,
      reasoning: cheap.reasoning,
      notes,
      aiCalled: true,
      degraded: true,
    }
  }
}
