import { describe, it, expect } from 'vitest'
import {
  daysBetween,
  looksLikeRegistrationUrl,
  parseExplicitDates,
  parseProgramFromTitle,
  parseTeamNumberFromTitle,
  withinRecencyWindow,
} from '../src/listings/connectors/shared.js'

// These parsers are the only place the listing crawlers turn prose into a
// value a reviewer might trust, so what they REFUSE to read matters as much as
// what they read.
const YEAR = 2026

describe('parseExplicitDates', () => {
  it('reads a single dated day', () => {
    const out = parseExplicitDates('Registration opens for July 11, 2026', YEAR)
    expect(out.startDate).toBe('2026-07-11')
    expect(out.endDate).toBeUndefined()
    expect(out.ambiguous).toBe(false)
  })

  it('reads a same-month range as start and end', () => {
    const out = parseExplicitDates('Kettering Kickoff is September 12-13, 2026', YEAR)
    expect(out.startDate).toBe('2026-09-12')
    expect(out.endDate).toBe('2026-09-13')
  })

  it('reads a range that crosses a month boundary', () => {
    const out = parseExplicitDates('Running July 31 - August 1, 2026', YEAR)
    expect(out.startDate).toBe('2026-07-31')
    expect(out.endDate).toBe('2026-08-01')
  })

  it('reads an ISO date', () => {
    const out = parseExplicitDates('Doors open 2026-10-03 at eight', YEAR)
    expect(out.startDate).toBe('2026-10-03')
  })

  it('refuses a date with no year, because it would silently assume one', () => {
    const out = parseExplicitDates('See you on July 11 for the fall classic', YEAR)
    expect(out.startDate).toBeUndefined()
    expect(out.ambiguous).toBe(false)
  })

  it('ignores a year outside the plausible window', () => {
    const out = parseExplicitDates('We have run this since June 4, 2011', YEAR)
    expect(out.startDate).toBeUndefined()
  })

  it('fills in nothing when the thread offers two different dates', () => {
    const out = parseExplicitDates('Last year was July 12, 2025. This year is July 11, 2026.', YEAR)
    expect(out.startDate).toBeUndefined()
    expect(out.ambiguous).toBe(true)
    expect(out.evidence.length).toBe(2)
  })

  it('does not treat a range as two separate readings', () => {
    const out = parseExplicitDates('September 12-13, 2026', YEAR)
    expect(out.ambiguous).toBe(false)
    expect(out.startDate).toBe('2026-09-12')
  })

  it('rejects a day that does not exist', () => {
    const out = parseExplicitDates('February 31, 2026', YEAR)
    expect(out.startDate).toBeUndefined()
  })

  it('keeps the matched text as evidence a reviewer can check', () => {
    const out = parseExplicitDates('Set for July 11, 2026 in the main gym', YEAR)
    expect(out.evidence).toContain('July 11, 2026')
  })
})

describe('daysBetween', () => {
  it('counts an inclusive two-day event as two days', () => {
    expect(daysBetween('2026-09-12', '2026-09-13')).toBe(2)
  })

  it('treats a single date as one day', () => {
    expect(daysBetween('2026-09-12')).toBe(1)
  })

  it('returns nothing when the range runs backwards', () => {
    expect(daysBetween('2026-09-13', '2026-09-12')).toBeUndefined()
  })

  it('returns nothing without a start', () => {
    expect(daysBetween(undefined, '2026-09-13')).toBeUndefined()
  })
})

describe('parseTeamNumberFromTitle', () => {
  it('reads a team number behind an explicit label', () => {
    expect(parseTeamNumberFromTitle('Team 3538 Fall Classic').teamNumber).toBe(3538)
    expect(parseTeamNumberFromTitle('FRC 254 offseason').teamNumber).toBe(254)
  })

  it('ignores a bare number, which in a title is usually the year', () => {
    expect(parseTeamNumberFromTitle('2026 Fall Classic registration').teamNumber).toBeUndefined()
  })

  it('keeps the matched text as evidence', () => {
    expect(parseTeamNumberFromTitle('Team 3538 practice field').evidence).toBe('Team 3538')
  })
})

describe('parseProgramFromTitle', () => {
  it('reads an unambiguous program', () => {
    expect(parseProgramFromTitle('FRC offseason event')).toBe('frc')
    expect(parseProgramFromTitle('FTC scrimmage announcement')).toBe('ftc')
  })

  it('refuses when the title names both', () => {
    expect(parseProgramFromTitle('FRC and FTC scrimmage')).toBeUndefined()
  })

  it('refuses when the title names neither', () => {
    expect(parseProgramFromTitle('Fall Classic registration is open')).toBeUndefined()
  })
})

describe('looksLikeRegistrationUrl', () => {
  it('spots a sign-up form', () => {
    expect(looksLikeRegistrationUrl('https://forms.gle/abc123')).toBe(true)
    expect(looksLikeRegistrationUrl('https://example.org/register')).toBe(true)
    expect(looksLikeRegistrationUrl('https://www.eventbrite.com/e/thing')).toBe(true)
  })

  it('leaves an ordinary event site alone', () => {
    expect(looksLikeRegistrationUrl('https://kettering.example.org/about')).toBe(false)
  })
})

describe('withinRecencyWindow', () => {
  it('keeps a thread opened today', () => {
    expect(withinRecencyWindow(new Date().toISOString(), 400)).toBe(true)
  })

  it('drops a thread older than the window', () => {
    const old = new Date(Date.now() - 800 * 86_400_000).toISOString()
    expect(withinRecencyWindow(old, 400)).toBe(false)
  })

  it('keeps a thread with no timestamp, because absence is not age', () => {
    expect(withinRecencyWindow(null, 400)).toBe(true)
  })
})
