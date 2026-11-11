import { describe, it, expect } from 'bun:test'
import { parseVerdicts, verifyPrompt } from '../src/listings/verify-changes.js'
import { planEventRefresh, withoutChanges } from '../src/listings/event-refresh-plan.js'

const c = (key: string) => ({ key, label: key, from: '-', to: 'x', quote: 'q', source: 'https://a.org' })

describe('parseVerdicts', () => {
  it('reads verdicts and calls a missing or odd one unsure', () => {
    const v = parseVerdicts('{"verdicts":[{"key":"costUsd","verdict":"wrong","reason":"2026 page"},{"key":"name","verdict":"maybe"}]}', [c('costUsd'), c('name'), c('website')])
    expect(v.map((x) => x.verdict)).toEqual(['wrong', 'unsure', 'unsure'])
  })
  it('is all unsure on an answer that is not JSON', () => {
    expect(parseVerdicts('sorry', [c('a')])[0].verdict).toBe('unsure')
  })
})

describe('verifyPrompt', () => {
  it('puts the quoted page before the others and names today', () => {
    const p = verifyPrompt({ today: '2026-11-11', listing: { name: 'X' }, changes: [c('costUsd')], pages: [{ url: 'https://b.org', text: 'other' }, { url: 'https://a.org', text: 'quoted' }] })
    expect(p.indexOf('https://a.org ===')).toBeLessThan(p.indexOf('https://b.org ==='))
    expect(p).toContain('Today is 2026-11-11.')
  })
})

describe('withoutChanges', () => {
  it('drops a change and what was derived from it', () => {
    const plan = planEventRefresh({
      current: { id: 'a', name: 'E', startDate: '2026-10-30', endDate: '2026-11-01', seasonYear: 2026, venueName: 'Old HS', humanEditedFields: null },
      fields: { startDate: '2027-10-09', endDate: '2027-10-10', venueName: 'New Hope High School' },
      evidence: { startDate: { quote: 'Saturday October 9, 2027' }, endDate: { quote: 'Sunday October 10, 2027' }, venueName: { quote: 'held at New Hope High School' } },
      sources: [{ source: 'p', text: 'Saturday October 9, 2027 and Sunday October 10, 2027, held at New Hope High School' }],
      today: '2026-09-30',
    })
    expect(plan.patch.seasonYear).toBeDefined()
    const kept = withoutChanges(plan, new Set(['startDate']), () => 'second reading: wrong')
    expect(kept.patch.startDate).toBeUndefined()
    expect(kept.patch.seasonYear).toBeUndefined()
    expect(kept.patch.venueName).toBe('New Hope High School')
    expect(kept.needsRosterRefresh).toBe(true)
    expect(withoutChanges(plan, new Set(['startDate', 'endDate']), () => 'x').needsRosterRefresh).toBe(false)
    expect(kept.held.find((h) => h.key === 'startDate')?.detail).toBe('second reading: wrong')
  })
})
