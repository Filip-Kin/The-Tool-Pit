import { describe, it, expect } from 'vitest'
import type { GrantExtraction, GrantExtractionFields } from '@the-tool-pit/db'
import {
  evidenceMap,
  extractionFillCount,
  reviewDefaults,
  reviewRequirements,
} from '@/lib/admin/grant-review'

/**
 * What the review deck shows, and what it writes.
 *
 * The deck's whole claim is that a moderator is confirming a reading rather
 * than doing the research again. That only holds if a prefilled value came from
 * the extraction, carries its quote, and turns into the right row on approval.
 */

// #region fixture

const EMPTY_FIELD = { value: null, quote: null, source: null }

/** A complete extraction with everything empty, so a case sets only what it means. */
function extraction(partial: Partial<GrantExtractionFields> = {}): GrantExtraction {
  const keys: Array<keyof GrantExtractionFields> = [
    'name', 'funderName', 'summary', 'description', 'applyMethod', 'applicationUrl', 'contactEmail',
    'mailingAddress', 'awardMin', 'awardMax', 'awardCurrency', 'awardPhrase', 'renewable', 'effortLevel',
    'geoScope', 'countries', 'regions', 'localityNote', 'deadlineType', 'cycleYear', 'opensAt', 'deadlineAt',
    'deadlineNote', 'decisionAt', 'requires501c3', 'requiresEmployeeMentor', 'rookieOnly',
    'requiresSchoolAffiliation', 'ageRange', 'geographyRestriction', 'eligibilityText', 'programs',
  ]
  const triStates = new Set(['renewable', 'requires501c3', 'requiresEmployeeMentor', 'rookieOnly', 'requiresSchoolAffiliation'])
  const fields = {} as Record<string, unknown>
  for (const key of keys) {
    fields[key] = triStates.has(key) ? { value: 'unknown', quote: null, source: null } : { ...EMPTY_FIELD }
  }
  return {
    version: 1,
    fields: { ...(fields as unknown as GrantExtractionFields), ...partial },
    depth: 'shallow',
    evidenceUrls: ['https://funder.example/grant'],
    notes: [],
    extractedAt: '2026-09-01T00:00:00.000Z',
  }
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData()
  for (const [k, v] of Object.entries(entries)) data.append(k, v)
  return data
}

// #endregion

describe('reviewDefaults', () => {
  it('prefers the extraction over the classifier, because only one of them had to point at a sentence', () => {
    const defaults = reviewDefaults({
      url: 'https://funder.example/grant',
      extraction: extraction({
        name: { value: 'Westfield STEM Team Grant', quote: 'Westfield STEM Team Grant', source: 'funder_page' },
      }),
      classification: { name: 'Some Guessed Name', funderName: 'Westfield' },
      metadata: { title: 'Grants | Westfield' },
    })
    expect(defaults.name).toBe('Westfield STEM Team Grant')
    // Nothing was extracted for the funder, so the classifier still fills it.
    expect(defaults.funderName).toBe('Westfield')
  })

  it('falls back to the crawler metadata when neither pass had anything', () => {
    const defaults = reviewDefaults({
      url: 'https://funder.example/grant',
      metadata: { title: 'Team Grant', ogDescription: 'A grant for teams.' },
    })
    expect(defaults.name).toBe('Team Grant')
    expect(defaults.summary).toBe('A grant for teams.')
  })

  it('puts the funder’s own award wording in the award notes', () => {
    const defaults = reviewDefaults({
      url: 'https://funder.example/grant',
      extraction: extraction({
        awardPhrase: { value: 'varies, in-kind hardware only', quote: 'Support varies and is in kind', source: 'funder_page' },
      }),
    })
    expect(defaults.awardNotes).toBe('varies, in-kind hardware only')
    expect(defaults.awardMin).toBeNull()
    expect(defaults.awardMax).toBeNull()
  })

  it('answers unknown for every yes/no field when nothing has been extracted', () => {
    const defaults = reviewDefaults({ url: 'https://funder.example/grant' })
    expect(defaults.renewable).toBe('unknown')
    expect(defaults.eligibility.requires501c3).toBe('unknown')
    expect(defaults.eligibility.requiresEmployeeMentor).toBe('unknown')
    expect(defaults.eligibility.rookieOnly).toBe('unknown')
    expect(defaults.eligibility.requiresSchoolAffiliation).toBe('unknown')
  })

  it('reads the cycle year off a date it already has, and invents one otherwise', () => {
    const withDate = reviewDefaults({
      url: 'https://funder.example/grant',
      extraction: extraction({
        deadlineAt: { value: '2027-04-15', quote: 'applications close April 15, 2027', source: 'funder_page' },
      }),
    })
    expect(withDate.cycleYear).toBe(2027)

    const withoutDate = reviewDefaults({ url: 'https://funder.example/grant', extraction: extraction() })
    expect(withoutDate.cycleYear).toBeNull()
  })

  it('never carries a value the extraction did not support', () => {
    const defaults = reviewDefaults({ url: 'https://funder.example/grant', extraction: extraction() })
    expect(defaults.deadlineAt).toBe('')
    expect(defaults.opensAt).toBe('')
    expect(defaults.contactEmail).toBe('')
    expect(defaults.mailingAddress).toBe('')
    expect(defaults.applyMethod).toBe('unknown')
  })
})

describe('evidenceMap', () => {
  it('carries the quote and which text it came from', () => {
    const map = evidenceMap(
      extraction({
        deadlineAt: { value: '2027-04-15', quote: 'applications close April 15, 2027', source: 'funder_page' },
        eligibilityText: { value: 'Teams in southeast Michigan.', quote: 'teams in southeast Michigan', source: 'aggregator' },
      }),
    )
    expect(map.deadlineAt?.source).toBe('funder_page')
    expect(map.eligibilityText?.source).toBe('aggregator')
  })

  it('shows a disagreement between the two texts rather than hiding it', () => {
    const map = evidenceMap(
      extraction({
        awardMax: {
          value: 2000,
          quote: 'up to $2,000 per team',
          source: 'funder_page',
          conflict: 'The listing site says $5,000.',
        },
      }),
    )
    expect(map.awardMax?.conflict).toBe('The listing site says $5,000.')
  })

  it('says nothing about a field with no quote, so the deck shows a plain box', () => {
    expect(evidenceMap(extraction()).deadlineAt).toBeUndefined()
    expect(evidenceMap(null)).toEqual({})
  })
})

describe('extractionFillCount', () => {
  it('counts unknown as not filled, because that is the point of it', () => {
    const count = extractionFillCount(
      extraction({
        name: { value: 'A Grant', quote: null, source: null },
        requires501c3: { value: 'yes', quote: 'must be a 501(c)(3)', source: 'funder_page' },
      }),
    )
    expect(count.filled).toBe(2)
    expect(count.quoted).toBe(1)
    expect(count.total).toBe(32)
  })

  it('reports nothing for a candidate that has not been read yet', () => {
    expect(extractionFillCount(null)).toEqual({ filled: 0, total: 0, quoted: 0 })
  })
})

describe('reviewRequirements', () => {
  it('writes a rule only for a yes', () => {
    expect(reviewRequirements(form({ req501c3: 'no' }))).toEqual([])
    expect(reviewRequirements(form({ req501c3: 'unknown' }))).toEqual([])
    const rows = reviewRequirements(form({ req501c3: 'yes' }))
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('org_type')
    expect(rows[0].value).toEqual(['501c3', 'fiscal_sponsor'])
    expect(rows[0].isBlocking).toBe(true)
  })

  it('lets a fiscal sponsor satisfy a 501(c)(3) rule, because school teams apply that way', () => {
    const rows = reviewRequirements(form({ req501c3: 'yes' }))
    expect(rows[0].value).toContain('fiscal_sponsor')
  })

  it('maps rookie-only and school affiliation onto rules the matcher can test', () => {
    const rows = reviewRequirements(form({ reqRookieOnly: 'yes', reqSchoolAffiliation: 'yes' }))
    const kinds = rows.map((r) => r.kind)
    expect(kinds).toContain('rookie_only')
    expect(kinds).toContain('org_type')
    expect(rows.every((r) => r.isBlocking)).toBe(true)
  })

  it('never blocks on something the matcher cannot test', () => {
    const rows = reviewRequirements(
      form({
        reqEmployeeMentor: 'yes',
        reqAgeRange: 'grades 6-12',
        reqGeography: 'Wayne and Oakland counties',
        reqEligibilityText: 'Teams must have a mentor over 21.',
      }),
    )
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.kind === 'other')).toBe(true)
    expect(rows.some((r) => r.isBlocking)).toBe(false)
  })

  it('numbers the rows in the order they will be shown', () => {
    const rows = reviewRequirements(form({ req501c3: 'yes', reqRookieOnly: 'yes', reqAgeRange: 'grades 6-12' }))
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })

  it('writes nothing at all for an empty form', () => {
    expect(reviewRequirements(form({}))).toEqual([])
  })
})
