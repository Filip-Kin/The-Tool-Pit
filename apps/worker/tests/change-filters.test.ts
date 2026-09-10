import { describe, expect, it } from 'vitest'
import { awardNoteAddsFacts, eligibilityChanged, deadlineNoteIsWhole, applicationUrlIsNew, deadlineMovesTheDay } from '../src/grants/change-filters.js'

describe('monitor proposals worth a person', () => {
  it('award note: a new figure yes, a rewording no, a lost figure no', () => {
    expect(awardNoteAddsFacts('Grants of $500 to $2,000 per team.', null)).toBe(true)
    expect(awardNoteAddsFacts('Awards range from $500 up to $2,000.', 'Grants of $500 to $2,000 per team.')).toBe(false)
    expect(awardNoteAddsFacts('Grants up to $2,000.', 'Grants of $500 to $2,000 per team.')).toBe(false)
    expect(awardNoteAddsFacts('Grants of $500 to $2,000; up to 35 awards a year.', 'Grants of $500 to $2,000 per team.')).toBe(true)
    expect(awardNoteAddsFacts('Amounts vary by project.', null)).toBe(false)
  })
  it('eligibility: a new rule yes, a paraphrase no', () => {
    expect(eligibilityChanged('Applicants must be a 501(c)(3) or a public school.', 'Nonprofits and public schools may apply; 501(c)(3) status is required.')).toBe(false)
    expect(eligibilityChanged('Only rookie teams in Michigan are eligible.', 'Nonprofits and public schools may apply.')).toBe(true)
    expect(eligibilityChanged('We look forward to your application.', 'Nonprofits may apply.')).toBe(false)
  })
  it('deadline note: a sentence or a time of day, not a fragment', () => {
    expect(deadlineNoteIsWhole('Applications close at 5:00 pm Eastern.')).toBe(true)
    expect(deadlineNoteIsWhole('by 11:59 PM ET')).toBe(true)
    expect(deadlineNoteIsWhole('and returned to the office no later than')).toBe(false)
    expect(deadlineNoteIsWhole('Proposals are reviewed in the order received.')).toBe(true)
  })
  it('application link: not the info page, not the current one, not a front door', () => {
    expect(applicationUrlIsNew('https://f.org/grants/', null, 'https://f.org/grants')).toBe(false)
    expect(applicationUrlIsNew('https://f.org/apply', 'https://f.org/apply/', 'https://f.org/grants')).toBe(false)
    expect(applicationUrlIsNew('https://www.submittable.com/', null, 'https://f.org/grants')).toBe(false)
    expect(applicationUrlIsNew('https://f.submittable.com/submit', null, 'https://f.org/grants')).toBe(true)
  })
  it('deadline: the day has to move, and the opening date is not the close', () => {
    expect(deadlineMovesTheDay('2026-09-10T03:59:59Z', new Date('2026-09-10T00:00:00Z'), null)).toBe(false)
    expect(deadlineMovesTheDay('2026-09-15', new Date('2026-09-10T00:00:00Z'), null)).toBe(true)
    expect(deadlineMovesTheDay('2026-08-01', null, '2026-08-01')).toBe(false)
    expect(deadlineMovesTheDay('2026-08-31', null, '2026-08-01')).toBe(true)
  })
})
