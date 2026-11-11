/**
 * TBA's span against the reader's competition days at intake. Dates count
 * competition days only, never a load-in day.
 */
import { describe, it, expect } from 'bun:test'
import { competitionDaysInside } from '../src/listings/read-candidates.js'

describe('competitionDaysInside', () => {
  it('trims a TBA span that starts on load-in day', () => {
    // Roboteer Rumble: TBA Oct 23-24, Friday load-in and practice, Saturday competition.
    expect(competitionDaysInside({ startDate: '2026-10-23', endDate: '2026-10-24' }, { startDate: '2026-10-24', endDate: null }))
      .toEqual({ startDate: '2026-10-24', endDate: null })
  })

  it('keeps two competition days inside a three-day span', () => {
    expect(competitionDaysInside({ startDate: '2026-10-09', endDate: '2026-10-11' }, { startDate: '2026-10-10', endDate: '2026-10-11' }))
      .toEqual({ startDate: '2026-10-10', endDate: '2026-10-11' })
  })

  it('keeps TBA when the reader read dates outside its span', () => {
    // Last year's page.
    expect(competitionDaysInside({ startDate: '2027-02-20', endDate: '2027-02-21' }, { startDate: '2026-02-21', endDate: '2026-02-22' })).toEqual({})
  })

  it('changes nothing when they agree or the reader has no dates', () => {
    expect(competitionDaysInside({ startDate: '2026-10-24', endDate: null }, { startDate: '2026-10-24' })).toEqual({})
    expect(competitionDaysInside({ startDate: '2026-10-23', endDate: '2026-10-24' }, {})).toEqual({})
  })
})
