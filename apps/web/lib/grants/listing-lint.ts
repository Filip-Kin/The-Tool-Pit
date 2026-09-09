/**
 * Reader-quality rules for a grant listing. The extractor is a model reading
 * a page, and a model narrates: "the page is an eligibility quiz", "award
 * amounts are not stated in the available metadata", "Geography: Unsure".
 * A mentor reading the listing needs the grant, not the reading. These rules
 * run at publish (the gate refuses), at render (old rows), and in the scrub
 * that cleans what is already live.
 */

/** A value that means "nothing", shown as if it were a fact. */
const JUNK_VALUE_RE = /^\s*(unsure|unknown|not (stated|specified|provided|listed|given|available|mentioned)|n\/?a|none|null|tbd|varies|unclear|\?+|-+)\s*\.?\s*$/i

export function isJunkRequirementLabel(label: string): boolean {
  const bare = label.replace(/^(geography|ages? served|ages?|eligibility|region|location)\s*:\s*/i, '')
  return JUNK_VALUE_RE.test(bare) || bare.trim().length < 3
}

export { splitSentences, isNarration, narrationIn, scrubNarration } from '@the-tool-pit/db/listing-text'
import { splitSentences, narrationIn } from '@the-tool-pit/db/listing-text'

const REQUIREMENT_TOPICS: Array<[RegExp, RegExp]> = [
  // [what the prose says, what a blocking row about it says]
  [/501\s?\(?c\)?\s?\(?3\)?|nonprofit|non-profit|charit|tax[- ]exempt/i, /501\(c\)\(3\)|fiscal sponsor/i],
  [/\bschool\b/i, /school team|attached to a school/i],
  [/\brookie\b|first[- ]year/i, /rookie|first-year/i],
]

/**
 * A prose note that only restates the boxes above it. Every sentence has to
 * be covered for it to go; a note that adds one new fact stays whole,
 * because the funder's wording is the evidence and we do not edit it.
 */
export function restatesRequirement(prose: string, blocking: Array<{ label: string }>): boolean {
  const sentences = splitSentences(prose)
  if (sentences.length === 0) return false
  return sentences.every((s) =>
    REQUIREMENT_TOPICS.some(([topic, row]) => topic.test(s) && blocking.some((b) => row.test(b.label))),
  )
}

/** Phrases from the platform voice rules that a listing must not carry. */
const VOICE_RE = /\b(worth noting|it'?s worth|notably|crucially|importantly|in summary|in conclusion|overall,|additionally,|furthermore,|moreover,|leverage|robust|seamless|comprehensive|holistic|empower(s|ing)?|unlock|delve|landscape|ecosystem|tailored|cutting[- ]edge|state[- ]of[- ]the[- ]art)\b/i

export interface ListingLintIssue {
  field: 'name' | 'funder' | 'summary' | 'description' | 'requirement' | 'awardNotes'
  text: string
  problem: string
}

/** Everything wrong with the listing as a reader would see it. */
export function lintListing(values: {
  name?: string | null
  funderName?: string | null
  summary?: string | null
  description?: string | null
  awardNotes?: string | null
  requirementLabels?: string[]
}): ListingLintIssue[] {
  const out: ListingLintIssue[] = []
  for (const field of ['summary', 'description', 'awardNotes'] as const) {
    const text = values[field]
    if (!text) continue
    for (const s of narrationIn(text)) out.push({ field, text: s, problem: 'describes the page or the reading, not the grant' })
    const m = text.match(VOICE_RE)
    if (m) out.push({ field, text: m[0], problem: 'marketing or machine phrasing' })
  }
  const name = values.name ?? ''
  if (/\b(the|this) (page|site|form|portal)\b|\bclick\b|\bwelcome to\b/i.test(name) || /[.!?]$/.test(name.trim()) || name.length > 120) {
    out.push({ field: 'name', text: name, problem: 'reads as a page title or a sentence, not a programme name' })
  }
  // "Community Request System", "Corporate Funding Application Portal",
  // "Grant Application": the portal's name, not the programme's.
  if (/\b(request system|application portal|funding portal|grant portal|grant application|application form|login|sign[- ]?in|request form)\b\s*$/i.test(name) || /\s[-–]\s(grants?|apply|application)\s*$/i.test(name)) {
    out.push({ field: 'name', text: name, problem: 'names the portal or the form, not the programme' })
  }
  const funder = values.funderName ?? ''
  if (funder && (funder.length > 70 || /[.!?]$/.test(funder.trim()) || /\b(in partnership with|in collaboration with|and its|which|that)\b/i.test(funder))) {
    out.push({ field: 'funder', text: funder, problem: 'the funder field holds a sentence, not an organisation' })
  }
  if (!values.summary || values.summary.trim().length < 40) {
    out.push({ field: 'summary', text: values.summary ?? '', problem: 'no usable summary' })
  }
  for (const label of values.requirementLabels ?? []) {
    if (isJunkRequirementLabel(label)) out.push({ field: 'requirement', text: label, problem: 'an empty value shown as a fact' })
  }
  return out
}
