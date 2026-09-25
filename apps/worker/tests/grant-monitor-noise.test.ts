import { describe, expect, it } from 'vitest'
import { wholeDeadlineNote } from '../src/grants/change-filters.js'
import {
  awardMoveIsPerAward,
  awardQuote,
  cycleWithSameWindow,
  deadlineIsNews,
  dropMonitorNoise,
  isPastRound,
  sameDeadline,
  statusIsNews,
  type StoredCycle,
} from '../src/grants/monitor.js'

// Real rows from the 2026-09-25 review of 15 pending grant_changes.

const NOW = new Date('2026-09-25T12:00:00Z')
const ET = 'America/New_York'
const CT = 'America/Chicago'

function cycle(c: Partial<StoredCycle> & { cycleYear: number }): StoredCycle {
  return { opensAt: null, deadlineAt: null, deadlineNote: null, status: 'unknown', ...c }
}

const ctx = (cycles: StoredCycle[], zone = ET, extra: { awardNotes?: string; pageText?: string } = {}) => ({
  cycles,
  zone,
  now: NOW,
  awardNotes: extra.awardNotes ?? null,
  pageText: extra.pageText ?? '',
})

describe('rule 1: same instant, different form', () => {
  it('a date-only proposal is the stored 23:59 Eastern on that day', () => {
    const stored = new Date('2026-11-17T04:59:00Z')
    expect(sameDeadline('2026-11-16', stored, ET)).toBe(true)
    expect(deadlineIsNews('2026-11-16', stored, null, ET)).toBe(false)
  })
  it('a midnight-UTC proposal is the stored 3 pm Central on that day', () => {
    const stored = new Date('2026-04-30T20:00:00Z')
    expect(sameDeadline('2026-04-30T00:00:00.000Z', stored, CT)).toBe(true)
    expect(deadlineIsNews('2026-04-30T00:00:00.000Z', stored, null, CT)).toBe(false)
  })
  it('another day is still news', () => {
    expect(deadlineIsNews('2026-11-20', new Date('2026-11-17T04:59:00Z'), null, ET)).toBe(true)
    expect(deadlineIsNews('2026-05-01T00:00:00.000Z', new Date('2026-04-30T20:00:00Z'), null, CT)).toBe(true)
    expect(deadlineIsNews('2026-11-16', null, null, ET)).toBe(true)
  })
  it('the gate drops the row against the stored cycle', () => {
    const { kept } = dropMonitorNoise(
      [{ field: 'cycle.2026.deadlineAt', oldValue: '2026-11-17T04:59:00.000Z', newValue: '2026-11-16', reasoning: '' }],
      ctx([cycle({ cycleYear: 2026, deadlineAt: new Date('2026-11-17T04:59:00Z'), status: 'open' })]),
    )
    expect(kept).toHaveLength(0)
  })
})

describe('rule 2: same window, other cycle year', () => {
  const y2025 = cycle({ cycleYear: 2025, opensAt: '2025-08-01', deadlineAt: new Date('2026-03-01T05:59:00Z'), status: 'closed' })
  it('cycle.2026 with the 2025 cycle dates is the 2025 cycle', () => {
    expect(cycleWithSameWindow(2026, { opensAt: '2025-08-01', deadlineAt: '2026-02-28' }, [y2025], CT)?.cycleYear).toBe(2025)
  })
  it('a different deadline is a different cycle', () => {
    expect(cycleWithSameWindow(2026, { opensAt: '2026-08-01', deadlineAt: '2027-02-28' }, [y2025], CT)).toBeNull()
    expect(cycleWithSameWindow(2026, { opensAt: '2025-08-01', deadlineAt: '2027-02-28' }, [y2025], CT)).toBeNull()
  })
  it('the gate drops every row of that year', () => {
    const { kept, dropped } = dropMonitorNoise(
      [
        { field: 'cycle.2026.opensAt', oldValue: null, newValue: '2025-08-01', reasoning: '' },
        { field: 'cycle.2026.deadlineAt', oldValue: null, newValue: '2026-02-28', reasoning: '' },
      ],
      ctx([y2025], CT),
    )
    expect(kept).toHaveLength(0)
    expect(dropped.map((d) => d.reason)).toEqual(["dates are the stored 2025 cycle's", "dates are the stored 2025 cycle's"])
  })
})

describe('rule 3: status already there', () => {
  const open2026 = cycle({ cycleYear: 2026, opensAt: '2026-08-01', deadlineAt: new Date('2026-11-17T04:59:00Z'), status: 'open' })
  it('open over a stored open is not news; closed is', () => {
    expect(statusIsNews('open', open2026, NOW)).toBe(false)
    expect(statusIsNews('closed', open2026, NOW)).toBe(true)
  })
  it('a stored unknown whose dates derive open is already open', () => {
    expect(statusIsNews('open', { ...open2026, status: 'unknown' }, NOW)).toBe(false)
  })
  it('the gate compares with the stored value, not the old_value captured earlier', () => {
    const { kept } = dropMonitorNoise(
      [{ field: 'cycle.2026.status', oldValue: 'unknown', newValue: 'open', reasoning: '' }],
      ctx([open2026]),
    )
    expect(kept).toHaveLength(0)
  })
  it('a derived status goes when its date is dropped as noise', () => {
    const stored = { ...open2026, status: 'upcoming', opensAt: '2026-10-01' }
    const { kept, dropped } = dropMonitorNoise(
      [
        { field: 'cycle.2026.deadlineAt', oldValue: null, newValue: '2026-11-16', reasoning: '' },
        { field: 'cycle.2026.status', oldValue: 'upcoming', newValue: 'open', reasoning: '', derivedFromDates: true },
      ],
      ctx([stored]),
    )
    expect(kept).toHaveLength(0)
    expect(dropped.at(-1)?.reason).toBe('status rests on a date that was not filed')
  })
  it('a derived status stays when its date is filed', () => {
    const stored = cycle({ cycleYear: 2026, deadlineAt: new Date('2026-09-01T03:59:00Z'), status: 'closed' })
    const { kept } = dropMonitorNoise(
      [
        { field: 'cycle.2026.deadlineAt', oldValue: null, newValue: '2026-11-16', reasoning: '' },
        { field: 'cycle.2026.status', oldValue: 'closed', newValue: 'open', reasoning: '', derivedFromDates: true },
      ],
      ctx([stored]),
    )
    expect(kept.map((c) => c.field)).toEqual(['cycle.2026.deadlineAt', 'cycle.2026.status'])
  })
})

describe('rule 4: fragment notes', () => {
  it('trims a mid-word window to its whole sentence', () => {
    expect(
      wholeDeadlineNote('ment via Memo: July 2026 Grant Application Submitted online no later than September 30, 2026, at 5:00 p.m. Funds expend'),
    ).toBe('July 2026 Grant Application Submitted online no later than September 30, 2026, at 5:00 p.m.')
    expect(
      wholeDeadlineNote('ing the full grant application. Applications must have been submitted by 3:00 PM Central Time on April 30, 2026. Applic'),
    ).toBe('Applications must have been submitted by 3:00 PM Central Time on April 30, 2026.')
  })
  it('keeps a whole sentence, refuses a fragment with no sentence in it', () => {
    expect(wholeDeadlineNote('Applications close at 5:00 pm Eastern.')).toBe('Applications close at 5:00 pm Eastern.')
    expect(wholeDeadlineNote('and returned to the office no later than')).toBeNull()
    expect(wholeDeadlineNote('ing the full grant appl')).toBeNull()
  })
  it('the gate files the trimmed sentence', () => {
    const { kept } = dropMonitorNoise(
      [{ field: 'cycle.2026.deadlineNote', oldValue: null, newValue: 'ing the full grant application. Applications must have been submitted by 3:00 PM Central Time on April 30, 2026. Applic', reasoning: '' }],
      ctx([cycle({ cycleYear: 2026 })], CT),
    )
    expect(kept[0]?.newValue).toBe('Applications must have been submitted by 3:00 PM Central Time on April 30, 2026.')
  })
})

describe('rule 5: past round', () => {
  const tracked = [cycle({ cycleYear: 2027, opensAt: '2026-10-01', status: 'upcoming' })]
  it('a gone deadline for a year before the newest cycle is history', () => {
    expect(isPastRound(2026, '2026-01-26', tracked, NOW)).toBe(true)
    expect(isPastRound(2027, '2027-01-26', tracked, NOW)).toBe(false)
    expect(isPastRound(2026, '2026-12-01', tracked, NOW)).toBe(false)
    expect(isPastRound(2026, '2026-01-26', [], NOW)).toBe(false)
  })
  it('the gate does not file it', () => {
    const { kept } = dropMonitorNoise(
      [{ field: 'cycle.2026.deadlineAt', oldValue: null, newValue: '2026-01-26', reasoning: '(for 2025-2026 grant cycle)' }],
      ctx(tracked),
    )
    expect(kept).toHaveLength(0)
  })
})

describe('rule 6: award from another programme on the page', () => {
  const pool = 'Beginning in 2026, up to $100,000 of the grant funds will be used to provide grants to elementary robotics programs.'
  const lending = 'The equipment lending program has an annual budget of $10,000 to $15,000 for kits and field elements.'
  it('a pool is not an award', () => {
    expect(awardMoveIsPerAward(3500, 100000, pool)).toBe(false)
    expect(awardMoveIsPerAward(1000, 10000, lending)).toBe(false)
    expect(awardMoveIsPerAward(1000, 15000, lending)).toBe(false)
  })
  it('a per-award cue lets a big move through; a small move needs none', () => {
    expect(awardMoveIsPerAward(3500, 25000, 'Grants of up to $25,000 per team.')).toBe(true)
    expect(awardMoveIsPerAward(3500, 5000, pool)).toBe(true)
    expect(awardMoveIsPerAward(null, 100000, pool)).toBe(true)
  })
  it('the quote is the award note when it has the figure, else the page sentence', () => {
    expect(awardQuote(100000, null, `Teams receive $3,500. ${pool}`)).toBe(pool)
    expect(awardQuote(3500, 'Teams receive $3,500.', pool)).toBe('Teams receive $3,500.')
  })
  it('the gate drops the pool and the lending budget', () => {
    const { kept } = dropMonitorNoise(
      [
        { field: 'awardMax', oldValue: 3500, newValue: 100000, reasoning: '' },
        { field: 'awardMin', oldValue: 1000, newValue: 10000, reasoning: '' },
      ],
      ctx([], ET, { pageText: `Teams receive up to $3,500. ${pool} ${lending}` }),
    )
    expect(kept).toHaveLength(0)
  })
})
