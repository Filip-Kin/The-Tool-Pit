import { describe, it, expect } from 'vitest'
import type { GrantExtraction, GrantExtractionFields } from '@the-tool-pit/db'
import { reviewDefaults, dateOnlyDeadline } from '@/lib/admin/grant-review'
import { parseCycleFields } from '@/lib/admin/grants'
import { lintListing } from '@/lib/grants/listing-lint'
import { formFromReviewDefaults, publishBlockers } from '@/lib/admin/grant-publish'

/**
 * Cases from the audit of the 38 grants published on 2026-09-23 against the
 * funders' live pages (dates, status, info links).
 */

const EMPTY_FIELD = { value: null, quote: null, source: null }
function extraction(partial: Partial<GrantExtractionFields> = {}, extra: Partial<GrantExtraction> = {}): GrantExtraction {
  const keys: Array<keyof GrantExtractionFields> = [
    'name', 'funderName', 'summary', 'description', 'applyMethod', 'applicationUrl', 'contactEmail',
    'mailingAddress', 'awardMin', 'awardMax', 'awardCurrency', 'awardPhrase', 'renewable', 'effortLevel',
    'geoScope', 'countries', 'regions', 'localityNote', 'deadlineType', 'cycleYear', 'opensAt', 'deadlineAt',
    'deadlineNote', 'decisionAt', 'requires501c3', 'requiresEmployeeMentor', 'rookieOnly',
    'requiresSchoolAffiliation', 'ageRange', 'geographyRestriction', 'eligibilityText', 'programs',
  ]
  const triStates = new Set(['renewable', 'requires501c3', 'requiresEmployeeMentor', 'rookieOnly', 'requiresSchoolAffiliation'])
  const fields = {} as Record<string, unknown>
  for (const key of keys) fields[key] = triStates.has(key) ? { value: 'unknown', quote: null, source: null } : { ...EMPTY_FIELD }
  return {
    version: 1,
    fields: { ...(fields as unknown as GrantExtractionFields), ...partial },
    depth: 'shallow',
    evidenceUrls: ['https://funder.example/grant'],
    notes: [],
    extractedAt: '2026-09-23T00:00:00.000Z',
    ...extra,
  }
}
const f = <T,>(value: T) => ({ value, quote: 'q', source: 'funder_page' as const })
const NOW = new Date('2026-09-23T16:00:00Z')

describe('a date-only deadline keeps its date', () => {
  it('3M: closes October 17, 2026, stored as 23:59 Eastern, not NULL', () => {
    const d = reviewDefaults({
      url: 'https://www.firstinspires.org/robotics/team-grants',
      extraction: extraction({ name: f('3M FIRST Team Grant'), geoScope: f('national'), opensAt: f('2026-09-17'), deadlineAt: f('2026-10-17') }),
    })
    expect(d.deadlineAt).toBe('2026-10-17T23:59:00-04:00')
    expect(d.deadlineNote).toBe('No time given')
    const cycle = parseCycleFields(formFromReviewDefaults(d), { now: NOW })
    expect(cycle.error).toBeUndefined()
    expect(cycle.values.deadlineAt?.toISOString()).toBe('2026-10-18T03:59:00.000Z')
    expect(cycle.values.status).toBe('open')
  })
  it('a state grant reads the state\'s zone (AMSTI, Alabama)', () => {
    expect(dateOnlyDeadline('2026-09-30', '', { geoScope: 'state', regions: ['AL'] })).toEqual({ at: '2026-09-30T23:59:00-05:00', note: 'No time given' })
  })
  it('keeps the funder\'s words after the label, once', () => {
    expect(dateOnlyDeadline('2026-11-16', '"Applications due November 16, 2026."', { geoScope: 'state', regions: ['VT'] }).note).toBe('No time given. "Applications due November 16, 2026."')
    expect(dateOnlyDeadline('2026-11-16', 'No time given', {}).note).toBe('No time given')
  })
  it('the proof pass\'s dated sentence fills the deadline and its window the opening', () => {
    const d = reviewDefaults({
      url: 'https://www.firstinspires.org/robotics/team-grants',
      extraction: extraction({ geoScope: f('national') }, { deadlineProof: { kind: 'dated', date: '2026-10-17', opens: '2026-09-17', quote: 'The team grant application will open September 17, 2026, and close October 17, 2026.', url: 'u', urlsRead: ['u'], checkedAt: '' } }),
    })
    expect(d.deadlineAt).toBe('2026-10-17T23:59:00-04:00')
    expect(d.opensAt).toBe('2026-09-17')
    expect(d.deadlineNote).toMatch(/^No time given\. "The team grant application/)
    expect(d.deadlineType).toBe('fixed')
  })
  it('a yearless deadline is a pattern: annual, no date (Marion County "due by April 17")', () => {
    const d = reviewDefaults({
      url: 'https://mccfiowa.org/simple-grant-application/',
      extraction: extraction({}, { deadlineProof: { kind: 'recurring', monthDay: '04-17', quote: 'Grant applications are due by April 17.', url: 'u', urlsRead: ['u'], checkedAt: '' } }),
    })
    expect(d.deadlineAt).toBe('')
    expect(d.cycleYear).toBeNull()
    expect(d.deadlineType).toBe('annual_window')
  })
})

describe('cycle status is derived from the dates', () => {
  const form = (entries: Record<string, string>) => {
    const data = new FormData()
    for (const [k, v] of Object.entries(entries)) data.append(k, v)
    return data
  }
  it('upcoming before the window opens (J.B. Hunt, stored as unknown)', () => {
    const c = parseCycleFields(form({ cycleYear: '2026', opensAt: '2026-12-01', deadlineAt: '2026-12-31T23:59:00-06:00', cycleStatus: 'unknown' }), { now: NOW })
    expect(c.values.status).toBe('upcoming')
  })
  it('closed after the deadline even when the form said open (Union Pacific 2026)', () => {
    const c = parseCycleFields(form({ cycleYear: '2026', opensAt: '2026-04-01', deadlineAt: '2026-04-30T15:00:00-05:00', cycleStatus: 'open' }), { now: NOW })
    expect(c.values.status).toBe('closed')
  })
  it('the page\'s word stands where there are no dates (Con Edison: "the 2026 cycle is closed")', () => {
    expect(parseCycleFields(form({ cycleYear: '2026', cycleStatus: 'closed' }), { now: NOW }).values.status).toBe('closed')
    expect(parseCycleFields(form({ cycleYear: '2026', cycleStatus: 'unknown' }), { now: NOW }).values.status).toBe('unknown')
  })
  it('a bare date in the cycle editor is read in the grant\'s zone, not refused', () => {
    const c = parseCycleFields(form({ cycleYear: '2026', deadlineAt: '2026-11-02' }), { now: NOW, timeZone: 'America/New_York' })
    expect(c.error).toBeUndefined()
    expect(c.values.deadlineAt?.toISOString()).toBe('2026-11-03T04:59:00.000Z')
    expect(c.values.deadlineNote).toBe('No time given')
    expect(c.values.status).toBe('open')
  })
})

describe('the info link must be the funder\'s programme page', () => {
  const ready = extraction({}, { fit: { level: 'robotics', reason: '', model: '', checkedAt: '' }, applyRoute: { status: 'form', url: 'https://f.org/apply', email: null, evidence: '', chain: [], checkedAt: '' }, deadlineProof: { kind: 'rolling', urlsRead: ['u'], checkedAt: '' } })
  const blockers = (infoUrl: string, applicationUrl = 'https://f.org/apply') => {
    const data = new FormData()
    data.set('applicationUrl', applicationUrl)
    return publishBlockers(ready, { name: 'Youth Development Grant Program', infoUrl, deadlineType: 'rolling' }, data, NOW)
  }
  it('refuses a grant-finder directory (Westfield, Sheltering Arms, PEC on grantable.co)', () => {
    expect(blockers('https://grantable.co/grants/westfield-service-league-grant-program').join(' ')).toMatch(/grant-finder directory/)
  })
  it('refuses an archive copy (Sony on web.archive.org)', () => {
    expect(blockers('https://web.archive.org/web/20260902000000/https://www.sony.com/en/SonyInfo/csr/').join(' ')).toMatch(/archive copy/)
  })
  it('refuses a PDF', () => {
    expect(blockers('https://www.td.com/content/dam/tdcom/us/en/pdf/td-community-sponsorship.pdf').join(' ')).toMatch(/is a PDF/)
  })
  it('refuses a grant-finder application link', () => {
    expect(blockers('https://sheltering-arms.org/youth-development/', 'https://grantable.co/grants/pec-community-grants').join(' ')).toMatch(/application link is a grant-finder/)
  })
  it('passes the funder\'s own page', () => {
    expect(blockers('https://sheltering-arms.org/youth-development/').join(' ')).not.toMatch(/info link|application link/)
  })
})

describe('funder names ending in an abbreviation', () => {
  it('reads "Giving Hope Inc." as an organisation, not a sentence', () => {
    const issues = lintListing({ name: 'Giving Hope Grant Program', funderName: 'Giving Hope Inc.', summary: 'Grants for youth education programmes in South Dakota, applied for online.' })
    expect(issues.some((i) => i.field === 'funder')).toBe(false)
    expect(lintListing({ name: 'X Grant', funderName: 'We fund schools.', summary: 'Grants for youth education programmes in South Dakota, applied for online.' }).some((i) => i.field === 'funder')).toBe(true)
  })
})
