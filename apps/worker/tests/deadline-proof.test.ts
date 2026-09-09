import { describe, expect, it } from 'vitest'
import { findDeadlineProof } from '../src/grants/deadline-proof.js'

const TODAY = '2026-09-08'

describe('findDeadlineProof', () => {
  it('finds a dated deadline with its sentence', () => {
    const r = findDeadlineProof([{ url: 'u', text: 'Some intro. Completed applications are due to the VDOE Office of STEM on or before 5 p.m. on September 18, 2026. Thanks.' }], TODAY)
    expect(r.kind).toBe('dated')
    expect(r.date).toBe('2026-09-18')
    expect(r.quote).toContain('September 18, 2026')
  })
  it('reports a past date as a past cycle, not a deadline', () => {
    const r = findDeadlineProof([{ url: 'u', text: 'All applications were due by February 9, 2026, at 12 PM. FY27 application timeline is expected to be posted by mid-September.' }], TODAY)
    expect(r.kind).toBe('not_public')
    expect(r.quote).toContain('expected to be posted')
    expect(r.past?.date).toBe('2026-02-09')
  })
  it('recognises the not-yet-announced phrasings', () => {
    for (const t of [
      'Applications for the 2026-2027 academic year will open in early October 2026.',
      'Next application cycle expected to open August 1, 2027.',
      'The 2026 application dates have not been announced.',
      'Application deadline: TBD.',
    ]) expect(findDeadlineProof([{ url: 'u', text: t }], TODAY).kind, t).toBe('not_public')
  })
  it('recognises rolling', () => {
    const r = findDeadlineProof([{ url: 'u', text: 'There are no deadlines for submitting letters of inquiry or grant applications.' }], TODAY)
    expect(r.kind).toBe('rolling')
  })
  it('says none when the pages are silent', () => {
    const r = findDeadlineProof([{ url: 'a', text: 'We love robots and teachers.' }, { url: 'b', text: 'Contact us for details.' }], TODAY)
    expect(r.kind).toBe('none')
    expect(r.urlsRead).toEqual(['a', 'b'])
  })
})

describe('findDeadlineProof rejects furniture and schedules', () => {
  it('a survey header with a date in it is not a deadline', () => {
    const r = findDeadlineProof([{ url: 'u', text: 'Skip survey header WISCONSIN ROBOTICS LEAGUE PARTICIPATION GRANT APPLICATION 2026/2027 through October 5, 2026.' }], '2026-09-08')
    expect(r.kind).not.toBe('dated')
  })
  it('"by" alone next to a date is not a deadline', () => {
    const r = findDeadlineProof([{ url: 'u', text: 'Grant recipients will be notified by November 2, 2026.' }], '2026-09-08')
    expect(r.kind).not.toBe('dated')
  })
  it('"due" with a date is', () => {
    const r = findDeadlineProof([{ url: 'u', text: 'All proposals are due on June 12, 2027.' }], '2026-09-08')
    expect(r.kind).toBe('dated')
    expect(r.date).toBe('2027-06-12')
  })
})

import { isoFromYearless, findDeadlineProof as fdp } from '../src/grants/deadline-proof.js'
describe('deadlines written without a year', () => {
  it('reads the next occurrence', () => {
    expect(isoFromYearless('Applications are due November 15.', '2026-09-09')).toBe('2026-11-15')
    expect(isoFromYearless('Deadline: March 1', '2026-09-09')).toBe('2027-03-01')
    expect(isoFromYearless('Proposals must be received by 15 March.', '2026-09-09')).toBe('2027-03-15')
    expect(isoFromYearless('Due 11/15', '2026-09-09')).toBe('2026-11-15')
    expect(isoFromYearless('Applications are due November 15, 2025.', '2026-09-09')).toBeNull()
  })
  it('counts as a dated proof below a full date and above nothing', () => {
    const p = fdp([{ url: 'https://f.org/grants', text: 'The AAUW Community Action Grant supports projects. Applications are due November 15. Awards are announced in April.' }], '2026-09-09')
    expect(p.kind).toBe('dated')
    expect(p.date).toBe('2026-11-15')
  })
})

import { dateForCue } from '../src/grants/deadline-proof.js'
describe('a timeline row with several dates', () => {
  it('takes the date after the deadline word, not the opening date', () => {
    const row = 'Milestone Date LETTER OF INTEREST (LOI) FORM OPENS August 17, 2026 9:00am ET DEADLINE FOR LETTER OF INTEREST (LOI) FORM SUBMISSION September 17, 2026 5:00pm ET NOTIFICATION OF LOI FORM REVIEW DECISION October 15, 2026'
    expect(dateForCue(row)?.[0]).toMatch(/September 17, 2026/)
    const p = fdp([{ url: 'https://aauw.org/x', text: row }], '2026-09-09')
    expect(p.kind).toBe('dated')
    expect(p.date).toBe('2026-09-17')
  })
  it('ignores a scholarship or report deadline on a grant page', () => {
    const p = fdp([{ url: 'https://f.org/x', text: 'January 15th is the scholarship application deadline. Grant proposals are reviewed on a rolling basis.' }], '2026-09-09')
    expect(p.kind).toBe('rolling')
  })
})

import { windowsIn } from '../src/grants/deadline-proof.js'
describe('application windows', () => {
  it('reads "Application Period: start - end" as opens and deadline', () => {
    const t = 'Basic Needs and Income Creation | Application Period: 2/2/2026 - 3/2/2026 Stable Housing and Empowering Communities | Application Period: 5/18/2026 - 6/29/2026 How do we ensure we are eligible?'
    const w = windowsIn(t, '2026-09-09')
    expect(w.map((x) => [x.opens, x.date])).toEqual([['2026-02-02', '2026-03-02'], ['2026-05-18', '2026-06-29']])
    const p = fdp([{ url: 'https://boa.com/faq', text: t }], '2026-09-09')
    expect(p.kind).toBe('none')
    expect(p.past?.date).toBe('2026-06-29')
    const p2 = fdp([{ url: 'https://boa.com/faq', text: t }], '2026-06-01')
    expect(p2.kind).toBe('dated')
    expect(p2.date).toBe('2026-06-29')
    expect(p2.opens).toBe('2026-05-18')
  })
  it('reads "accepted March 1 through April 15, 2026"', () => {
    const w = windowsIn('Applications are accepted March 1, 2026 through April 15, 2026.', '2026-01-01')
    expect(w[0]).toMatchObject({ opens: '2026-03-01', date: '2026-04-15' })
  })
})
describe('a fiscal year is not an application window', () => {
  it('skips FY spans and year-long periods', () => {
    expect(windowsIn('Maryland Robotics Grant FY 2027 (July 1, 2026 - June 30, 2027). Proposals are due no later than 5:00 p.m. on June 5, 2026.', '2026-09-09')).toEqual([])
    expect(windowsIn('Grant period: January 1, 2027 - December 31, 2027.', '2026-09-09')).toEqual([])
  })
})
