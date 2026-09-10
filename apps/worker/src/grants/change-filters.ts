/**
 * What the monitor may put in front of a person.
 *
 * A review of 191 monitor proposals on 2026-09-09 dismissed 177: rewordings
 * of a note already on file, mid-sentence fragments as deadline notes,
 * eligibility paraphrases with no new rule, the info page offered as the
 * application link, an opening date filed as the deadline, past rounds
 * offered as new, and the same calendar day at a different instant. Each of
 * those is a predicate here, pure, so the noise is refused before it is
 * filed rather than dismissed after.
 */
import { scrubNarration } from '@the-tool-pit/db/listing-text'

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g

export function numbersIn(text: string | null | undefined): Set<string> {
  return new Set((text ?? '').match(NUMBER_RE)?.map((n) => n.replace(/,/g, '')) ?? [])
}

/**
 * An award note is worth a person's click when it carries a figure the
 * listing does not have yet and drops none it has. A rewording with the
 * same numbers is not a change; a note that loses a number is a loss.
 */
export function awardNoteAddsFacts(next: string | null | undefined, current: string | null | undefined): boolean {
  const clean = scrubNarration(next, 1)
  if (!clean) return false
  const a = numbersIn(clean)
  const b = numbersIn(current)
  if (a.size === 0) return false
  for (const n of b) if (!a.has(n)) return false
  for (const n of a) if (!b.has(n)) return true
  return false
}

const RULE_CUE = /\b(must|only|eligible|ineligible|required|requirement|not eligible|cannot|exclud|501\(c\)|nonprofit|non-profit|school|district|rookie|employee|mentor|located|within|serving|budget|match)\b/i

/**
 * The rule-bearing tokens of an eligibility sentence: the topics a rule can
 * be about, proper nouns (a state, a county, a company) and numbers. Two
 * sentences with the same tokens are the same rule in other words.
 */
export function ruleTokens(text: string): Set<string> {
  const out = new Set<string>()
  const t = text.replace(/501\s?\(c\)\s?\(?3\)?/gi, ' 501c3 ')
  for (const m of t.matchAll(/\b(501c3|non-?profits?|charit\w*|schools?|districts?|rookies?|first-year|employees?|mentors?|teachers?|students?|budget|match(ing)?|title i|underserved|counties|county|located|within \d+ miles|k-?12|elementary|middle|high school|grades? \d+|fiscal sponsor|invitation|unsolicited)\b/gi)) {
    out.add(m[1].toLowerCase().replace(/s$/, '').replace(/-/g, ''))
  }
  // A proper noun mid-sentence (Michigan, Boeing); a capital at the start of a sentence is just a sentence.
  for (const m of t.matchAll(/(?<=[a-z0-9,;:] )([A-Z][a-z]{3,})\b/g)) out.add(m[1].toLowerCase())
  for (const m of t.matchAll(/\$?\d[\d,]*/g)) out.add(m[0].replace(/[$,]/g, ''))
  return out
}

/** Eligibility wording is worth filing when it states a rule the previous wording did not carry. */
export function eligibilityChanged(next: string, previous: string | null): boolean {
  if (!RULE_CUE.test(next)) return false
  if (!previous) return true
  const before = ruleTokens(previous)
  for (const tok of ruleTokens(next)) if (!before.has(tok)) return true
  return false
}

/** A deadline note is a sentence about the closing time, not a fragment cut mid-sentence. */
export function deadlineNoteIsWhole(note: string): boolean {
  const t = note.trim()
  if (t.length < 12) return false
  if (/\b\d{1,2}(:\d{2})?\s?(a\.?m\.?|p\.?m\.?)\b|\b(noon|midnight|eastern|pacific|central|mountain|et|pt|ct|mt)\b/i.test(t)) return true
  if (!/^[A-Z"“(]/.test(t)) return false
  if (!/[.!?]$/.test(t)) return false
  return t.split(/\s+/).length >= 6
}

function keyOf(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`.toLowerCase()
  } catch {
    return url.trim().replace(/\/$/, '').toLowerCase()
  }
}

/** An application link proposal is worth filing when it is not the info page, not the current link, and not a site's front door. */
export function applicationUrlIsNew(next: string, current: string | null, infoUrl: string): boolean {
  const k = keyOf(next)
  if (k === keyOf(infoUrl)) return false
  if (current && k === keyOf(current)) return false
  try {
    const u = new URL(next)
    if (u.pathname.replace(/\/$/, '') === '' && !u.search) return false
  } catch {
    return false
  }
  return true
}

/** The calendar day in the US Eastern zone, which is where the deadlines on these pages are written. */
export function easternDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/**
 * A deadline proposal is worth filing when it moves the DAY. The same day
 * at another instant is the extractor guessing a time of day; and a date
 * equal to the round's opening date is the opening date read as the close.
 */
export function deadlineMovesTheDay(next: string, currentDeadline: Date | null, opensAt: string | null): boolean {
  const nextDay = /^\d{4}-\d{2}-\d{2}$/.test(next.trim()) ? next.trim() : Number.isNaN(Date.parse(next)) ? null : easternDay(new Date(next))
  if (!nextDay) return false
  if (opensAt && nextDay === opensAt.slice(0, 10)) return false
  if (!currentDeadline) return true
  return easternDay(currentDeadline) !== nextDay
}
