import { isJunkRequirementLabel, restatesRequirement } from '@/lib/grants/listing-lint'
import type { GrantProgram } from '@the-tool-pit/db/grant-enums'
/**
 * The review deck's pure half: what the deck shows, and what it writes.
 *
 * Kept out of the page so both halves can be tested without a database. The
 * rules here are the ones that decide what a moderator sees beside a value and
 * what reaches `grants`, `grant_cycles` and `grant_requirements` when they
 * press Approve.
 *
 * The deck exists because 280 candidates cannot be researched by hand. It can
 * only be honest about that if every prefilled value carries the quote it came
 * off and says which text that was: the funder's own page, or a blurb somebody
 * else wrote. Confirming a reading is a different job from doing the research
 * again, and only the first one scales.
 */
import type {
  ExtractedField,
  GrantClassification,
  GrantEvidenceSource,
  GrantExtraction,
  GrantExtractionFields,
  GrantTriState,
  RawGrantMetadata,
} from '@the-tool-pit/db'

// #region evidence for the deck

/** What the deck renders under one input. */
export interface FieldEvidence {
  quote: string | null
  source: GrantEvidenceSource | null
  /** Set when the funder page and the third-party blurb disagreed. */
  conflict: string | null
}

export type EvidenceMap = Partial<Record<keyof GrantExtractionFields, FieldEvidence>>

function evidenceOf(field: ExtractedField<unknown> | undefined): FieldEvidence | undefined {
  if (!field || (!field.quote && !field.conflict)) return undefined
  return { quote: field.quote, source: field.source, conflict: field.conflict ?? null }
}

/** Every quote the extraction carried, keyed by field, for rendering beside the inputs. */
export function evidenceMap(extraction: GrantExtraction | null | undefined): EvidenceMap {
  if (!extraction) return {}
  const out: EvidenceMap = {}
  for (const [key, field] of Object.entries(extraction.fields) as Array<
    [keyof GrantExtractionFields, ExtractedField<unknown>]
  >) {
    const evidence = evidenceOf(field)
    if (evidence) out[key] = evidence
  }
  return out
}

// #endregion

// #region defaults

/** The eligibility answers the deck asks about, as tri-states. */
export interface ReviewEligibilityDefaults {
  requires501c3: GrantTriState
  requiresEmployeeMentor: GrantTriState
  rookieOnly: GrantTriState
  requiresSchoolAffiliation: GrantTriState
  ageRange: string
  geographyRestriction: string
  eligibilityText: string
}

export interface ReviewDefaults {
  name: string
  funderName: string
  summary: string
  description: string
  infoUrl: string
  applicationUrl: string
  applyMethod: string
  contactEmail: string
  mailingAddress: string
  programs: string[]
  geoScope: string
  countries: string[]
  regions: string[]
  localityNote: string
  awardMin: number | null
  awardMax: number | null
  awardCurrency: string
  awardNotes: string
  renewable: GrantTriState
  deadlineType: string
  effortLevel: string
  cycleYear: number | null
  opensAt: string
  deadlineAt: string
  deadlineNote: string
  decisionAt: string
  eligibility: ReviewEligibilityDefaults
}

function text(field: ExtractedField<string> | undefined, fallback = ''): string {
  return field?.value ?? fallback
}

function tri(field: ExtractedField<GrantTriState> | undefined): GrantTriState {
  return field?.value ?? 'unknown'
}

/** The four-digit year at the front of an ISO date, or null. */
function yearOf(value: string | null): number | null {
  if (!value) return null
  const year = parseInt(value.slice(0, 4), 10)
  return Number.isFinite(year) ? year : null
}

/**
 * Fill the deck.
 *
 * Precedence is extraction, then the classifier, then the crawler's metadata.
 * The extraction wins because it is the only one of the three that had to point
 * at a sentence on the page. Nothing here invents a value: an empty box means
 * neither pass could support one, and that is a true thing to show.
 */
export function reviewDefaults(input: {
  url: string
  extraction?: GrantExtraction | null
  classification?: GrantClassification | null
  metadata?: RawGrantMetadata | null
}): ReviewDefaults {
  const fields = input.extraction?.fields
  const cls = input.classification ?? {}
  const meta = input.metadata ?? {}
  const sub = meta.submitted ?? {}

  // The award phrase is the funder's own wording and it is what a team reads
  // when there is no figure at all. "varies" and "up to $5,000 in kind" are
  // most of why the award columns were empty on 89% of candidates.
  const awardNotes = text(fields?.awardPhrase)

  return {
    name: text(fields?.name, cls.name ?? meta.title ?? ''),
    funderName: text(fields?.funderName, cls.funderName ?? meta.funderName ?? ''),
    summary: text(fields?.summary, cls.summary ?? meta.ogDescription ?? meta.description ?? ''),
    description: text(fields?.description),
    infoUrl: input.url,
    applicationUrl: text(fields?.applicationUrl, meta.applicationUrl ?? ''),
    applyMethod: text(fields?.applyMethod, 'unknown') || 'unknown',
    contactEmail: text(fields?.contactEmail, sub.contactEmail ?? ''),
    mailingAddress: text(fields?.mailingAddress),
    programs: fields?.programs.value ?? cls.programs ?? (sub.programs as GrantProgram[] | undefined) ?? ['any'],
    geoScope: text(fields?.geoScope, cls.geoScope ?? sub.geoScope ?? 'national') || 'national',
    countries: fields?.countries.value ?? cls.countries ?? ['US'],
    regions: fields?.regions.value ?? cls.regions ?? sub.regions ?? [],
    // Geography is one fact on the card. The restriction wording joins it when
    // the extractor gave no locality note; it is never a second box below.
    localityNote: text(fields?.localityNote) || (isJunkRequirementLabel(text(fields?.geographyRestriction)) ? '' : text(fields?.geographyRestriction)),
    awardMin: fields?.awardMin.value ?? cls.awardMin ?? null,
    awardMax: fields?.awardMax.value ?? cls.awardMax ?? sub.awardMax ?? null,
    awardCurrency: text(fields?.awardCurrency, 'USD') || 'USD',
    awardNotes,
    renewable: tri(fields?.renewable),
    deadlineType: (text(fields?.deadlineType, cls.deadlineType ?? sub.deadlineType ?? 'unknown') || 'unknown') === 'unknown' && input.extraction?.deadlineProof?.kind === 'rolling' ? 'rolling' : (text(fields?.deadlineType, cls.deadlineType ?? sub.deadlineType ?? 'unknown') || 'unknown') === 'unknown' && input.extraction?.deadlineProof?.kind === 'dated' ? 'fixed' : (text(fields?.deadlineType, cls.deadlineType ?? sub.deadlineType ?? 'unknown') || 'unknown'),
    effortLevel: text(fields?.effortLevel, sub.effortLevel ?? 'unknown') || 'unknown',
    // The year a cycle closes in is not a guess when a date is already in
    // hand: it is the year printed on that date. Only ever read off a date the
    // extraction supported with a quote.
    cycleYear: fields?.cycleYear.value ?? yearOf(fields?.deadlineAt.value ?? fields?.opensAt.value ?? (input.extraction?.deadlineProof?.kind === 'dated' ? input.extraction.deadlineProof.date ?? null : null)),
    opensAt: text(fields?.opensAt),
    // The extractor's date, else the submitter's, else the funder's own dated
    // sentence the proof pass found (dates are the fact a team needs most).
    deadlineAt: text(fields?.deadlineAt, sub.deadlineAt ?? (input.extraction?.deadlineProof?.kind === 'dated' ? input.extraction.deadlineProof.date ?? '' : '')),
    deadlineNote: text(fields?.deadlineNote) || (!fields?.deadlineAt.value && input.extraction?.deadlineProof?.kind === 'dated' && input.extraction.deadlineProof.quote ? `"${input.extraction.deadlineProof.quote.slice(0, 200)}"` : ''),
    decisionAt: text(fields?.decisionAt),
    eligibility: {
      requires501c3: tri(fields?.requires501c3),
      requiresEmployeeMentor: tri(fields?.requiresEmployeeMentor),
      rookieOnly: tri(fields?.rookieOnly),
      requiresSchoolAffiliation: tri(fields?.requiresSchoolAffiliation),
      ageRange: text(fields?.ageRange),
      geographyRestriction: text(fields?.geographyRestriction),
      eligibilityText: text(fields?.eligibilityText, sub.eligibility ?? ''),
    },
  }
}

// #endregion

// #region requirements written on approval

export interface ReviewRequirementRow {
  kind: string
  operator: string
  value: string | number | boolean | string[] | null
  label: string
  isBlocking: boolean
  sortOrder: number
}

/**
 * Turn the deck's eligibility answers into grant_requirements rows.
 *
 * Only 'yes' writes a row. 'no' and 'unknown' write nothing, because a
 * requirement row is a rule that can rule a team OUT, and "the funder does not
 * require this" is not a rule. The tri-state itself stays readable on the
 * candidate's extraction, which is where "not stated on the funder's page"
 * belongs.
 *
 * Anything the matcher cannot test goes in as kind 'other' and never blocks.
 * parseRequirementFields in ./grants.ts enforces that same rule on the manual
 * editor, and breaking it here would rule teams out on a rule nothing ever
 * evaluates.
 */
export function reviewRequirements(form: FormData): ReviewRequirementRow[] {
  const rows: ReviewRequirementRow[] = []
  const value = (key: string): string => String(form.get(key) ?? '').trim()
  const push = (row: Omit<ReviewRequirementRow, 'sortOrder'>) => {
    rows.push({ ...row, sortOrder: rows.length })
  }
  // The prose the reader has already seen. A box that repeats it is padding.
  const prose = `${value('summary')} ${value('description')}`
  const eligibility = value('reqEligibilityText')
  const context = `${prose} ${eligibility} ${value('reqGeography')}`

  // Schools are government bodies, not 501(c)(3)s, and most funders that ask
  // for a 501(c)(3) take a public school or district as well. When the text
  // says so, the box says so; a team reading "must be a 501(c)(3)" next to
  // "schools can apply" stops trusting both.
  const schoolsEligible = /\b(public |charter |k-?12 )?(schools?|school districts?|districts|LEAs?|ISDs?|public (bodies|entities|agencies|institutions)|government(al)? (entities|agencies|units)|municipalit(y|ies))\b/i.test(context) && !/\bschools? (are|is) not eligible|not (open|available) to schools\b/i.test(context)
  const wants501c3 = value('req501c3') === 'yes'
  const wantsSchool = value('reqSchoolAffiliation') === 'yes'
  if (wants501c3 && wantsSchool) {
    // Both boxes ticked means "either", never "both": no team is a school AND a charity.
    push({ kind: 'org_type', operator: 'in', value: ['501c3', 'fiscal_sponsor', 'school', 'school_club'], label: 'Applicant must be a 501(c)(3), a school, or apply through a 501(c)(3)', isBlocking: true })
  } else if (wants501c3) {
    push({
      kind: 'org_type',
      operator: 'in',
      // A team applying through a fiscal sponsor that is a 501(c)(3) meets
      // this, and plenty of school teams do exactly that.
      value: schoolsEligible ? ['501c3', 'fiscal_sponsor', 'school', 'school_club'] : ['501c3', 'fiscal_sponsor'],
      label: schoolsEligible ? 'Applicant must be a 501(c)(3), a public school or district, or apply through a 501(c)(3)' : 'Applicant must be a 501(c)(3), or apply through one',
      isBlocking: true,
    })
  } else if (wantsSchool) {
    push({ kind: 'org_type', operator: 'in', value: ['school', 'school_club'], label: 'Team must be a school team or attached to a school', isBlocking: true })
  }
  if (value('reqRookieOnly') === 'yes') {
    push({ kind: 'rookie_only', operator: 'is', value: true, label: 'Rookie or first-year teams only', isBlocking: true })
  }
  // "An employee must mentor the team" is a real rule at BAE, Boeing and Gene
  // Haas and an invented one everywhere the extractor ticked the box for a
  // teacher or an adult advisor. The text has to name the funder's people.
  if (value('reqEmployeeMentor') === 'yes' && /\b(employees?|associates?|staff|team members?|retirees?|colleagues?|our people|workforce)\b/i.test(context)) {
    push({
      kind: 'other',
      operator: 'exists',
      value: null,
      label: 'An employee or member of the funder must mentor or sponsor the team',
      // Nothing in a team profile records who mentors them, so this is prose.
      isBlocking: false,
    })
  }

  // "Ages served: 18+" is the applicant's age, "youth" and "all grade levels"
  // say nothing. A range stays only when it reads like one for students.
  const ageRange = value('reqAgeRange')
  if (ageRange && /\b(k-?\d{1,2}|grades?\s?\d|ages?\s?\d{1,2}|\d{1,2}\s?(-|to|–)\s?\d{1,2}|under \d{1,2}|\d{1,2} and (under|younger)|elementary|middle school|high school)\b/i.test(ageRange) && !/\b(18\+|adults?|over 18|21\+)\b/i.test(ageRange) && !isJunkRequirementLabel(ageRange)) {
    push({ kind: 'other', operator: 'exists', value: null, label: `Ages served: ${trimLabel(ageRange)}`, isBlocking: false })
  }
  // Geography is a fact on the card (geographyLabel), not a note; the note
  // repeated the card on nearly every listing. It goes to localityNote
  // instead, once, in reviewDefaults.
  if (eligibility && !isJunkRequirementLabel(eligibility) && !restatesRequirement(eligibility, rows.filter((r) => r.isBlocking)) && !repeatsProse(eligibility, prose)) {
    push({ kind: 'other', operator: 'exists', value: null, label: trimLabel(eligibility), isBlocking: false })
  }

  return rows
}

/** A label cut at a word, never mid-word ("Hertf"), and never longer than the column. */
export function trimLabel(text: string, max = 500): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '))
  return `${cut.slice(0, at > max / 2 ? at : cut.length).trim()}…`
}

/**
 * True when most of the note's sentences already appear in the summary or
 * the description. Word-for-word repeats were the most common complaint in
 * a read of every live listing (2026-09-09).
 */
export function repeatsProse(note: string, prose: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const hay = norm(prose)
  if (!hay) return false
  const sentences = note.split(/(?<=[.!?])\s+/).map(norm).filter((x) => x.length > 15)
  if (sentences.length === 0) return hay.includes(norm(note))
  const repeated = sentences.filter((x) => hay.includes(x) || hay.includes(x.slice(0, Math.min(60, x.length)))).length
  return repeated / sentences.length >= 0.6
}

// #endregion

/** How many fields the extraction actually filled, for the deck's header. */
export function extractionFillCount(extraction: GrantExtraction | null | undefined): {
  filled: number
  total: number
  quoted: number
} {
  if (!extraction) return { filled: 0, total: 0, quoted: 0 }
  const values = Object.values(extraction.fields)
  return {
    filled: values.filter((f) => f.value !== null && f.value !== 'unknown').length,
    total: values.length,
    quoted: values.filter((f) => f.quote !== null).length,
  }
}
