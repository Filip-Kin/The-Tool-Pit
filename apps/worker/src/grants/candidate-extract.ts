/**
 * Grant candidate extraction. The SECOND pass.
 *
 * ./classify.ts answers one question: can a team apply for the money on this
 * page. This file answers the other one: what does the page actually say. They
 * are separate model calls on purpose. A classifier that also extracts is a
 * classifier that invents a deadline to fill a field, and the grants vertical
 * exists downstream of that lesson.
 *
 * It runs only on candidates the classifier already accepted, so the spend is
 * one call per real grant rather than one per crawled URL.
 *
 * Three rules, and they are the whole design:
 *
 *   1. TRI-STATE, NEVER A BARE NULL. Every yes/no answer is yes, no or
 *      unknown. A blank meant both "the page says no" and "the page did not
 *      say", and a moderator could not tell those apart. "Not stated on the
 *      funder's page" is a useful line to render; a blank is not.
 *   2. EVERY VALUE CARRIES ITS QUOTE. The quote must appear verbatim in one of
 *      the two evidence texts. A value whose quote appears in neither is
 *      dropped, because the only thing that produces a quote nobody wrote is a
 *      model filling a field to be helpful. Unknown beats a guess.
 *   3. TWO EVIDENCE SOURCES, NAMED. `funder_page` is the text fetched from the
 *      candidate's own URL. `aggregator` is the blurb a third party wrote,
 *      which arrives in raw_metadata.description from grantexec, instrumentl
 *      and the like. Those blurbs are written by people and are often a better
 *      read on eligibility than the raw page, but they are second hand and they
 *      go stale, so the deck shows which is which. When the two disagree the
 *      funder's page wins and the disagreement is surfaced, not swallowed.
 *
 * Nothing here publishes. The output lands on the candidate for a human, and
 * the review deck turns approving a grant into confirming a reading.
 */
import Anthropic from '@anthropic-ai/sdk'
import { anthropic } from '../anthropic.js'
import {
  GRANT_APPLY_METHODS,
  GRANT_DEADLINE_TYPES,
  GRANT_EFFORT_LEVELS,
  GRANT_GEO_SCOPES,
  GRANT_PROGRAMS,
  GRANT_TRI_STATES,
  type ExtractedField,
  type GrantApplyMethod,
  type GrantCandidate,
  type GrantClassification,
  type GrantEvidenceSource,
  type GrantExtraction,
  type GrantExtractionFields,
  type GrantTriState,
} from '@the-tool-pit/db'
import { parseLooseDate } from './extract.js'
import { GRANT_AWARD_MAX } from '@the-tool-pit/db/grant-enums'
import { normaliseForQuoteMatch, quoteSource, urlSource } from '../model/evidence.js'

/** Bumped when the field set changes, so an old row reads as old. */
export const GRANT_EXTRACTION_VERSION = 1

/** Same model the classifier uses. Cheapest one that returns clean JSON. */
export const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001'

/**
 * How much of each evidence text the model sees. The funder page gets the
 * larger share because it is the thing being read; the aggregator blurb is a
 * paragraph in practice. Truncation is recorded in notes rather than hidden,
 * because a cap nobody can see is a cap on coverage.
 */
const FUNDER_TEXT_LIMIT = 14_000
const AGGREGATOR_TEXT_LIMIT = 4_000

/** Longest quote we keep. Long enough for a sentence, short enough to render. */
const MAX_QUOTE_CHARS = 300

// #region evidence

/**
 * The two texts a quote may be checked against.
 *
 * `funderPage` is what came back from the candidate's own URL. On a candidate
 * whose URL IS an aggregator entry that is still what it means: the page we
 * fetched. `aggregator` is the human-written blurb about the grant that a
 * third party published, which for us arrives on raw_metadata.
 */
export interface GrantEvidence {
  funderPage: string
  aggregator: string
}


/**
 * Where a quote really came from, or null when nobody wrote it.
 *
 * The funder's page is checked first and wins a tie: a line that appears in
 * both texts is the funder's own, and labelling it as second hand would make a
 * moderator trust it less than they should.
 */
export function verifyQuote(quote: string, evidence: GrantEvidence): GrantEvidenceSource | null {
  return quoteSource<GrantEvidenceSource>(quote, [
    { source: 'funder_page', text: evidence.funderPage },
    { source: 'aggregator', text: evidence.aggregator },
  ])
}

// #endregion

// #region field helpers

/** The answer for a field nothing supported. */
function emptyField<T>(): ExtractedField<T> {
  return { value: null, quote: null, source: null }
}

/** The answer for a tri-state nothing supported. Unknown is a value, not a blank. */
function unknownTriState(): ExtractedField<GrantTriState> {
  return { value: 'unknown', quote: null, source: null }
}

/**
 * Yes, no, or unknown. Anything the model returns that is not plainly one or
 * the other is unknown, including a bare null, the string "n/a" and "maybe".
 * Guessing here writes an eligibility rule that rules a team out.
 */
export function parseTriState(raw: unknown): GrantTriState {
  if (raw === true) return 'yes'
  if (raw === false) return 'no'
  if (typeof raw !== 'string') return 'unknown'
  const value = raw.trim().toLowerCase()
  if ((GRANT_TRI_STATES as readonly string[]).includes(value)) return value as GrantTriState
  if (value === 'y' || value === 'true' || value === 'required') return 'yes'
  if (value === 'n' || value === 'false' || value === 'not required') return 'no'
  return 'unknown'
}

interface RawField {
  value?: unknown
  quote?: unknown
  source?: unknown
  conflict?: unknown
}

function asRawField(raw: unknown): RawField {
  return raw !== null && typeof raw === 'object' ? (raw as RawField) : {}
}

function cleanQuote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, MAX_QUOTE_CHARS) : null
}

function cleanConflict(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed.slice(0, 300) : null
}

// #endregion

// #region deterministic reads

/**
 * "March 1 to April 15, 2027" as an open date and a close date.
 *
 * This exists because a window written as one phrase is the single most common
 * way a funder states both dates, and a model asked for two separate fields
 * reads one of them and leaves the other unknown. Deterministic, free, and it
 * only fires next to an application cue so that a fiscal year or a programme
 * date range in a footer cannot become a deadline.
 */
const RANGE_CUE = /applicat|apply|submission|submit|open|accept|window|cycle|round/i

const RANGE_SEPARATOR = /\s*(?:-|–|—|to|through|thru|until|and)\s*/i

export interface DateRangeRead {
  opensAt: string
  closesAt: string
  /** The sentence it came out of, usable as the supporting quote. */
  snippet: string
}

function isoDateOnly(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/**
 * Find one application window written as a range. Returns null unless exactly
 * one sentence in the text yields a valid ordered pair, because two competing
 * windows is a page we have not understood.
 */
export function readDateRange(text: string): DateRangeRead | null {
  if (!text.trim()) return null
  const sentences = text.split(/(?<=[.!?])\s+|\n/)
  const hits: DateRangeRead[] = []

  for (const sentence of sentences) {
    if (!RANGE_CUE.test(sentence)) continue
    const parts = sentence.split(RANGE_SEPARATOR)
    if (parts.length < 2) continue

    for (let i = 0; i < parts.length - 1; i++) {
      const left = parseLooseDate(parts[i])
      const right = parseLooseDate(parts[i + 1])
      if (!left || !right) continue
      // "March 1 to April 15, 2027" leaves the first half with no year of its
      // own, so parseLooseDate reads nothing from it. When it does read a year
      // from both, they still have to be in order to be a window.
      const opens = isoDateOnly(left)
      const closes = isoDateOnly(right)
      if (opens >= closes) continue
      hits.push({ opensAt: opens, closesAt: closes, snippet: sentence.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE_CHARS) })
      break
    }
  }

  const distinct = [...new Map(hits.map((h) => [`${h.opensAt}|${h.closesAt}`, h])).values()]
  return distinct.length === 1 ? distinct[0] : null
}

const MONEY_IN_PHRASE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k\b|thousand\b|million\b|m\b)?/gi

export interface AwardPhraseRead {
  awardMin: number | null
  awardMax: number | null
}

/**
 * Read whatever integers a verbatim award phrase contains.
 *
 * "typically $500 to $2,000 per team" has two, "up to $5,000 in kind" has one,
 * and "varies by project" has none. The phrase is kept either way: it is the
 * answer to "how much", and an integer column that cannot hold "varies" is
 * most of why the award fill rate was 11%.
 */
export function awardIntegersFromPhrase(phrase: string): AwardPhraseRead {
  const values: number[] = []
  for (const match of phrase.matchAll(MONEY_IN_PHRASE)) {
    const base = parseFloat(match[1].replace(/,/g, ''))
    if (!Number.isFinite(base)) continue
    const scale = (match[2] ?? '').toLowerCase()
    const value = scale.startsWith('k') || scale.startsWith('thousand')
      ? base * 1000
      : scale.startsWith('m')
        ? base * 1_000_000
        : base
    if (value >= 1 && value <= MAX_AWARD) values.push(Math.round(value))
  }
  if (values.length === 0) return { awardMin: null, awardMax: null }
  if (values.length === 1) return { awardMin: null, awardMax: values[0] }
  return { awardMin: Math.min(...values), awardMax: Math.max(...values) }
}

// #endregion

// #region value validation

/** Above this it is a phone number or a page id, not an award. */
const MAX_AWARD = GRANT_AWARD_MAX

function yearWindow(): { min: number; max: number } {
  const now = new Date().getUTCFullYear()
  return { min: now - 2, max: now + 4 }
}

function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function cleanInteger(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === 'string' ? Number(raw.replace(/[^0-9.]/g, '')) : Number(raw)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  return rounded >= min && rounded <= max ? rounded : null
}

function cleanEnum<T extends readonly string[]>(raw: unknown, allowed: T): T[number] | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : null
}

function cleanStringArray(raw: unknown, transform: (s: string) => string): string[] | null {
  if (!Array.isArray(raw)) return null
  const out = [...new Set(raw.filter((v): v is string => typeof v === 'string').map(transform).filter(Boolean))]
  return out.length > 0 ? out : null
}

function cleanEmail(raw: unknown): string | null {
  const text = cleanText(raw, 200)
  if (!text) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text) ? text : null
}

function cleanUrl(raw: unknown): string | null {
  const text = cleanText(raw, 500)
  if (!text) return null
  return /^https?:\/\//i.test(text) ? text : null
}

/** YYYY-MM-DD only, inside the plausible grant window. */
function cleanDateOnly(raw: unknown): string | null {
  const text = cleanText(raw, 30)
  if (!text) return null
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const { min, max } = yearWindow()
  const year = parseInt(match[1], 10)
  if (year < min || year > max) return null
  const probe = new Date(`${match[0]}T00:00:00Z`)
  return Number.isNaN(probe.getTime()) ? null : match[0]
}

/**
 * A deadline is either a date or an instant. An instant is kept ONLY with an
 * explicit offset, for the same reason the admin form refuses a zoneless one:
 * "11:59pm ET" and "11:59pm PT" are three hours apart and the container's own
 * timezone is not evidence of either.
 */
function cleanDeadline(raw: unknown): string | null {
  const text = cleanText(raw, 40)
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return cleanDateOnly(text)
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(text)) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  const { min, max } = yearWindow()
  const year = parsed.getUTCFullYear()
  return year >= min && year <= max ? text : null
}

// #endregion

// #region output validation

/**
 * Fields that do NOT need a supporting quote, and why each one is exempt.
 *
 * summary and description are the model's own prose by construction: a summary
 * that had to appear verbatim on the page would not be a summary, and
 * demanding one only teaches the model to paste a paragraph and call it a
 * quote. name and funderName are usually in the page title rather than the
 * body text we captured, and refusing a grant's own name would leave the deck
 * showing a URL where the heading should be.
 *
 * Everything else is a fact about money, dates, eligibility or contact, and a
 * fact with no quote behind it is exactly what this pass exists not to write.
 */
/**
 * A URL is not a claim you quote, it is a link that is either on the page or is
 * not. Asking the model for a supporting sentence was the wrong question, and
 * it showed: across the first full backfill only 3 of 74 records kept an
 * applicationUrl, and nearly every drop was "no supporting quote". The URL was
 * usually right there in the page. It was an anchor, not a sentence.
 *
 * So a URL field verifies against the evidence by PRESENCE. That is a stricter
 * test than a prose quote, not a looser one: the model cannot invent a link
 * that the page does not contain.
 *
 * Compared without the scheme, a trailing slash or a www, because a page that
 * writes href="/apply" and a model that resolves it to the absolute URL are
 * describing the same destination.
 */
export function verifyUrlPresence(url: string, evidence: GrantEvidence): GrantEvidenceSource | null {
  return urlSource<GrantEvidenceSource>(url, [
    { source: 'funder_page', text: evidence.funderPage },
    { source: 'aggregator', text: evidence.aggregator },
  ])
}

const QUOTE_EXEMPT: ReadonlySet<keyof GrantExtractionFields> = new Set([
  'name',
  'funderName',
  'summary',
  'description',
])

/** The tri-state fields, so validation can give them 'unknown' and not null. */
const TRI_STATE_FIELDS = [
  'renewable',
  'requires501c3',
  'requiresEmployeeMentor',
  'rookieOnly',
  'requiresSchoolAffiliation',
] as const

type TriStateFieldKey = (typeof TRI_STATE_FIELDS)[number]

/** Every field, with the cleaner that decides whether its value survives. */
type ValueCleaner = (raw: unknown) => unknown

const VALUE_CLEANERS: Record<Exclude<keyof GrantExtractionFields, TriStateFieldKey>, ValueCleaner> = {
  name: (raw) => cleanText(raw, 200),
  funderName: (raw) => cleanText(raw, 200),
  summary: (raw) => cleanText(raw, 400),
  description: (raw) => cleanText(raw, 4000),
  applyMethod: (raw) => cleanEnum(raw, GRANT_APPLY_METHODS),
  applicationUrl: cleanUrl,
  contactEmail: cleanEmail,
  mailingAddress: (raw) => cleanText(raw, 300),
  awardMin: (raw) => cleanInteger(raw, 1, MAX_AWARD),
  awardMax: (raw) => cleanInteger(raw, 1, MAX_AWARD),
  awardCurrency: (raw) => {
    const text = cleanText(raw, 3)
    return text && /^[A-Za-z]{3}$/.test(text) ? text.toUpperCase() : null
  },
  awardPhrase: (raw) => cleanText(raw, 300),
  effortLevel: (raw) => cleanEnum(raw, GRANT_EFFORT_LEVELS),
  geoScope: (raw) => cleanEnum(raw, GRANT_GEO_SCOPES),
  countries: (raw) => {
    const list = cleanStringArray(raw, (s) => s.trim().toUpperCase())
    const codes = list?.filter((c) => /^[A-Z]{2}$/.test(c)) ?? []
    return codes.length > 0 ? codes : null
  },
  regions: (raw) => cleanStringArray(raw, (s) => s.trim().toUpperCase()),
  localityNote: (raw) => cleanText(raw, 200),
  deadlineType: (raw) => cleanEnum(raw, GRANT_DEADLINE_TYPES),
  cycleYear: (raw) => {
    const { min, max } = yearWindow()
    return cleanInteger(raw, min, max)
  },
  opensAt: cleanDateOnly,
  deadlineAt: cleanDeadline,
  deadlineNote: (raw) => cleanText(raw, 200),
  decisionAt: cleanDateOnly,
  ageRange: (raw) => cleanText(raw, 120),
  geographyRestriction: (raw) => cleanText(raw, 300),
  eligibilityText: (raw) => cleanText(raw, 2000),
  programs: (raw) => {
    const list = cleanStringArray(raw, (s) => s.trim().toLowerCase())
    const valid = list?.filter((p) => (GRANT_PROGRAMS as readonly string[]).includes(p)) ?? []
    return valid.length > 0 ? valid : null
  },
}

const FIELD_KEYS = [
  ...(Object.keys(VALUE_CLEANERS) as Array<keyof GrantExtractionFields>),
  ...TRI_STATE_FIELDS,
]

export interface RawExtractionPayload {
  fields?: Record<string, unknown>
  reasoning?: unknown
}

export interface ValidatedExtraction {
  fields: GrantExtractionFields
  reasoning?: string
  /** Quotes that were in neither text, and anything else that bounded the read. */
  notes: string[]
}

/**
 * Turn raw model output into the stored shape. Pure, no I/O, so the rules that
 * matter can be tested against fixture pages instead of against the API.
 *
 * A field survives only if its value cleans AND its quote is found in one of
 * the evidence texts. Anything else comes back unknown with a note saying so,
 * which is a better thing to render than a number nobody can point at.
 */
export function validateGrantExtraction(
  payload: RawExtractionPayload,
  evidence: GrantEvidence,
): ValidatedExtraction {
  const raw = payload.fields ?? {}
  const notes: string[] = []
  // Built as a loose record because the loop walks heterogeneous fields, then
  // handed back through GrantExtractionFields, which types every key. The one
  // cast is the seam between the two.
  const out: Record<string, ExtractedField<unknown>> = {}

  for (const key of FIELD_KEYS) {
    const rawField = asRawField(raw[key])
    const quote = cleanQuote(rawField.quote)
    const source = quote ? verifyQuote(quote, evidence) : null
    const conflict = cleanConflict(rawField.conflict)

    if (quote && !source) {
      // The one failure worth naming every time: a quote nobody wrote is a
      // model filling a field to be helpful, and it is why this check exists.
      notes.push(`${key}: quote is in neither text, dropped ("${quote.slice(0, 60)}")`)
    }

    if ((TRI_STATE_FIELDS as readonly string[]).includes(key)) {
      const value = parseTriState(rawField.value)
      // No verified quote means neither text said it, whatever the model
      // answered. That is 'unknown', which is a real answer and not a blank.
      out[key] = value !== 'unknown' && source
        ? { value, quote, source, conflict }
        : unknownTriState()
      continue
    }

    const clean = VALUE_CLEANERS[key as Exclude<keyof GrantExtractionFields, TriStateFieldKey>]
    const value = clean(rawField.value)
    const exempt = QUOTE_EXEMPT.has(key)

    if (value === null || value === undefined) {
      out[key] = emptyField()
      continue
    }

    // A URL proves itself by being in the page. See verifyUrlPresence.
    if (key === 'applicationUrl' && typeof value === 'string') {
      const found = verifyUrlPresence(value, evidence)
      if (!found) {
        notes.push(`applicationUrl: not found in either text, dropped (${value})`)
        out[key] = emptyField()
        continue
      }
      out[key] = { value, quote: source ? quote : null, source: found, conflict }
      continue
    }

    if (!exempt && !source) {
      if (!quote) notes.push(`${key}: no supporting quote, dropped`)
      out[key] = emptyField()
      continue
    }

    // An exempt field keeps its value without a quote, but never keeps a quote
    // we could not find: showing a moderator a quote that is not on the page is
    // worse than showing them none.
    out[key] = { value, quote: source ? quote : null, source, conflict }
  }

  const fields = out as unknown as GrantExtractionFields
  applyDerivedFields(fields, evidence, notes)

  const reasoning = cleanText(payload.reasoning, 600)
  return { fields, reasoning: reasoning ?? undefined, notes }
}

/**
 * The two deterministic repairs, run after the model has had its say.
 *
 * Both only ever FILL a field the model left empty. Overwriting a value the
 * model read off the page with one a regex found would be trading evidence for
 * a pattern match.
 */
function applyDerivedFields(fields: GrantExtractionFields, evidence: GrantEvidence, notes: string[]): void {
  // 1. An award phrase with figures in it, where the integer columns are empty.
  const phrase = fields.awardPhrase.value
  if (phrase && (fields.awardMin.value === null || fields.awardMax.value === null)) {
    const read = awardIntegersFromPhrase(phrase)
    if (fields.awardMax.value === null && read.awardMax !== null) {
      fields.awardMax = { value: read.awardMax, quote: fields.awardPhrase.quote, source: fields.awardPhrase.source }
    }
    if (fields.awardMin.value === null && read.awardMin !== null) {
      fields.awardMin = { value: read.awardMin, quote: fields.awardPhrase.quote, source: fields.awardPhrase.source }
    }
  }

  // A minimum above a maximum is a misread, not a range.
  const min = fields.awardMin.value
  const max = fields.awardMax.value
  if (min !== null && max !== null && min > max) {
    fields.awardMin = { value: max, quote: fields.awardMin.quote, source: fields.awardMin.source }
    fields.awardMax = { value: min, quote: fields.awardMax.quote, source: fields.awardMax.source }
  }

  // 2. An application window written as one range, where a date is missing.
  if (fields.opensAt.value !== null && fields.deadlineAt.value !== null) return
  for (const [text, source] of [
    [evidence.funderPage, 'funder_page'],
    [evidence.aggregator, 'aggregator'],
  ] as const) {
    const range = readDateRange(text)
    if (!range) continue
    if (fields.opensAt.value === null) {
      fields.opensAt = { value: range.opensAt, quote: range.snippet, source }
    }
    if (fields.deadlineAt.value === null) {
      fields.deadlineAt = { value: range.closesAt, quote: range.snippet, source }
    }
    if (fields.cycleYear.value === null) {
      fields.cycleYear = { value: parseInt(range.closesAt.slice(0, 4), 10), quote: range.snippet, source }
    }
    notes.push(`dates filled from a stated application window (${range.opensAt} to ${range.closesAt})`)
    return
  }
}

// #endregion

// #region model call

export type ExtractorUnavailableKind = 'no_api_key' | 'credit_exhausted' | 'bad_response' | 'no_text'

export class GrantExtractorUnavailable extends Error {
  constructor(
    public readonly kind: ExtractorUnavailableKind,
    message: string,
  ) {
    super(message)
    this.name = 'GrantExtractorUnavailable'
  }
}

const CREDIT_EXHAUSTED_MARKER = 'credit balance is too low'

const SYSTEM_PROMPT = `You read ONE funding opportunity and fill in a record about it. A human reviews every field you produce before any of it is published, and a wrong deadline makes a team miss a grant, so an honest "unknown" costs nothing and a confident guess costs a team a funding round.

You are given up to two texts, labelled separately:
  FUNDER PAGE - the text of the page itself. Highest trust.
  AGGREGATOR BLURB - a summary somebody else wrote about this grant, from a grants database or a round-up. Written by a person and often clearer about eligibility than the page, but second hand and it can be out of date.

Fill EVERY field in the schema below. Attempt all of them. A field you leave unknown must be unknown because neither text says it, never because you did not look.

For every field return an object:
  { "value": <the value, or null>, "quote": "<verbatim text supporting it>", "source": "funder_page" | "aggregator", "conflict": null }

RULES ON QUOTES. This is the part that matters most.
- The quote must be copied EXACTLY from one of the two texts, character for character. Do not paraphrase it, do not tidy it, do not join two sentences that are not adjacent.
- "source" says which text you copied it from.
- If you cannot find a quote that supports a value, return value null (or "unknown" for a yes/no field) with quote null. A value with an invented quote is thrown away and counted against this extraction.
- If the funder page and the aggregator blurb disagree, use the FUNDER PAGE for the value and put one short sentence in "conflict" saying what the blurb said instead.

YES/NO FIELDS are "yes", "no" or "unknown". Never null, never "maybe". "unknown" means neither text says. "no" means a text says it is not required.

FIELDS
  name                      the programme name as printed
  funderName                the organisation handing out the money
  summary                   1 to 2 sentences: who can apply, for what, roughly how much. Your own words, plain English, no marketing copy.
  description               3 to 6 sentences with the detail a team needs: what it funds, what it does not fund, how the process works. Your own words.
  applyMethod               "online_form", "email", "letter", "contact" (make contact first, no form) or "unknown"
  applicationUrl            the URL where the application actually happens, if the text gives one and it is different from the page itself
  contactEmail              an email address for applications or questions
  mailingAddress            a postal address for applications, one line
  awardMin                  integer, the smallest award, digits only, no currency symbol
  awardMax                  integer, the largest award. A single figure goes in awardMax.
  awardCurrency             ISO code, e.g. "USD", "CAD"
  awardPhrase               the funder's OWN WORDS about the amount, verbatim and short: "varies", "up to $5,000 in kind", "typically $500 to $2,000 per team". Fill this even when there is no number at all. This is the field a team reads.
  renewable                 yes/no/unknown: can a team apply again in a later cycle
  effortLevel               ${GRANT_EFFORT_LEVELS.map((v) => `"${v}"`).join(', ')}: how big the application is
  geoScope                  ${GRANT_GEO_SCOPES.map((v) => `"${v}"`).join(', ')}
  countries                 ISO 3166-1 alpha-2 codes, e.g. ["US","CA"]
  regions                   state or province codes, e.g. ["MI","OH"]
  localityNote              a county or metro that has no code
  deadlineType              ${GRANT_DEADLINE_TYPES.map((v) => `"${v}"`).join(', ')}
  cycleYear                 integer, the calendar year the round CLOSES in
  opensAt                   "YYYY-MM-DD" when applications open
  deadlineAt                "YYYY-MM-DD", or a full instant WITH an offset ("2027-03-01T23:59:00-05:00") ONLY when the text gives both a time and a named timezone
  deadlineNote              the funder's own wording about timing, e.g. "11:59pm Eastern"
  decisionAt                "YYYY-MM-DD" when decisions are announced
  requires501c3             yes/no/unknown: must the applicant be a 501(c)(3), or apply through one
  requiresEmployeeMentor    yes/no/unknown: must an employee or member of the funder mentor or sponsor the team
  rookieOnly                yes/no/unknown: is it only for rookie or first-year teams
  requiresSchoolAffiliation yes/no/unknown: must the team be a school team or attached to a school
  ageRange                  the ages or grades served, e.g. "grades 6-12"
  geographyRestriction      the eligibility geography in the funder's words
  eligibilityText           everything else about who may apply, in plain words
  programs                  any of ["frc","ftc","fll","any"]. "any" means it funds youth STEM generally.

Return ONLY this JSON object, no markdown fences and no prose:
{ "fields": { "<field>": { "value": ..., "quote": ..., "source": ..., "conflict": ... }, ... }, "reasoning": "one or two sentences on what you could not read and why" }`

export interface ExtractionInput {
  url: string
  /** What the classifier already decided, so the model is not re-deciding it. */
  classification?: GrantClassification | null
  evidence: GrantEvidence
  /** Extra pages read in a deep pass, already folded into evidence.funderPage. */
  evidenceUrls: string[]
  depth: 'shallow' | 'deep'
  /** Set on a re-extraction, so the model knows what a human said was wrong. */
  reviewNote?: string | null
}

function buildUserContent(input: ExtractionInput): string {
  const lines: string[] = [`URL: ${input.url}`]
  const cls = input.classification
  if (cls?.name) lines.push(`Programme name from triage: ${cls.name}`)
  if (cls?.funderName) lines.push(`Funder from triage: ${cls.funderName}`)
  if (input.reviewNote) {
    // A flagged candidate is a second look, so say what was wrong the first
    // time rather than making the model find the same gap again.
    lines.push('', `A moderator flagged the previous read as wrong or thin: ${input.reviewNote}`)
  }

  lines.push('', '--- FUNDER PAGE ---', input.evidence.funderPage.trim() || '(no page text was captured)')
  lines.push(
    '',
    '--- AGGREGATOR BLURB ---',
    input.evidence.aggregator.trim() || '(no third-party blurb for this one)',
  )
  return lines.join('\n')
}

/**
 * Trim the evidence to what the prompt can carry. Returns the trimmed texts
 * and a note for anything cut, because a silent truncation looks exactly like
 * a page that did not state a deadline.
 */
export function limitEvidence(evidence: GrantEvidence): { evidence: GrantEvidence; notes: string[] } {
  const notes: string[] = []
  let funderPage = evidence.funderPage
  let aggregator = evidence.aggregator
  if (funderPage.length > FUNDER_TEXT_LIMIT) {
    notes.push(`page text truncated to ${FUNDER_TEXT_LIMIT} chars (${funderPage.length} read)`)
    funderPage = funderPage.slice(0, FUNDER_TEXT_LIMIT)
  }
  if (aggregator.length > AGGREGATOR_TEXT_LIMIT) {
    notes.push(`third-party blurb truncated to ${AGGREGATOR_TEXT_LIMIT} chars`)
    aggregator = aggregator.slice(0, AGGREGATOR_TEXT_LIMIT)
  }
  return { evidence: { funderPage, aggregator }, notes }
}

let _client: Anthropic | undefined
function getClient(): Anthropic {
  if (!_client) _client = anthropic()
  return _client
}

function parsePayload(text: string): RawExtractionPayload {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return JSON.parse((fence ? fence[1] : text).trim()) as RawExtractionPayload
}

/**
 * One model call for one candidate.
 *
 * Throws GrantExtractorUnavailable when no extraction could be produced at
 * all. The caller leaves extraction null so a later pass finds the row again,
 * rather than storing an empty record that reads like a page with nothing on
 * it.
 */
export async function extractGrantCandidate(input: ExtractionInput): Promise<GrantExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new GrantExtractorUnavailable('no_api_key', 'ANTHROPIC_API_KEY is not set')
  }

  const limited = limitEvidence(input.evidence)
  const prompt = buildUserContent({ ...input, evidence: limited.evidence })

  let response: Anthropic.Message
  try {
    response = await getClient().messages.create({
      model: EXTRACTION_MODEL,
      // The record is ~34 fields with a quote each, so the ceiling has to be
      // well clear of the classifier's 1024 or the JSON comes back truncated.
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.toLowerCase().includes(CREDIT_EXHAUSTED_MARKER)) {
      throw new GrantExtractorUnavailable(
        'credit_exhausted',
        `Anthropic credit balance exhausted while extracting ${input.url}`,
      )
    }
    throw err
  }

  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  if (!block) throw new GrantExtractorUnavailable('no_text', `No text block in reply for ${input.url}`)

  let payload: RawExtractionPayload
  try {
    payload = parsePayload(block.text)
  } catch {
    throw new GrantExtractorUnavailable(
      'bad_response',
      `Unparseable JSON for ${input.url}: ${block.text.slice(0, 200)}`,
    )
  }

  const validated = validateGrantExtraction(payload, limited.evidence)
  return {
    version: GRANT_EXTRACTION_VERSION,
    fields: validated.fields,
    model: EXTRACTION_MODEL,
    depth: input.depth,
    evidenceUrls: input.evidenceUrls,
    notes: [...limited.notes, ...validated.notes],
    reasoning: validated.reasoning,
    extractedAt: new Date().toISOString(),
  }
}

// #endregion

/**
 * Whether a candidate is worth an extraction call.
 *
 * Only pages the classifier called an applicable grant. An aggregator is a
 * source to crawl and an announcement is a page about a grant, and paying to
 * read fields off either of those is paying to fill a record nobody will
 * publish.
 */
export function shouldExtractCandidate(candidate: Pick<GrantCandidate, 'classification'>): boolean {
  const cls = candidate.classification
  if (!cls) return false
  return cls.isGrant === true && cls.isAggregator !== true && cls.isAnnouncement !== true
}

/** Convenience for the review deck and the tests: the plain value or null. */
export function fieldValue<T>(field: ExtractedField<T> | undefined): T | null {
  return field?.value ?? null
}
