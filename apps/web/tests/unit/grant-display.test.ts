import { describe, it, expect } from 'vitest'
import type { PublicGrant, PublicGrantCycle } from '@/lib/grants/grant-display'
import {
  cycleState,
  expectedNextWindow,
  formatDeadline,
  matchesFilters,
  resolveNextCycle,
  sortByUrgency,
} from '@/lib/grants/grant-display'

/**
 * The deadline maths, which is the part of the grants vertical that can be
 * wrong in a way that costs a team a funding round.
 *
 * Every case here is timezone-loaded on purpose: `grantCycles.deadlineAt` is a
 * timestamptz because "11:59pm ET" is a real instant, and the whole point of
 * these helpers is that they answer the same way wherever they run.
 */

function cycle(partial: Partial<PublicGrantCycle> & { cycleYear: number }): PublicGrantCycle {
  return {
    id: `cycle-${partial.cycleYear}-${partial.deadlineAt?.toISOString() ?? 'none'}`,
    opensAt: null,
    deadlineAt: null,
    deadlineNote: null,
    decisionAt: null,
    status: 'unknown',
    amountNote: null,
    sourceUrl: null,
    verifiedAt: null,
    isEstimated: false,
    ...partial,
  }
}

function grant(partial: Partial<PublicGrant> & { id: string }): PublicGrant {
  return {
    slug: partial.id,
    name: partial.id,
    summary: null,
    description: null,
    infoUrl: 'https://example.org/grant',
    applicationUrl: null,
    programs: ['any'],
    geoScope: 'national',
    countries: ['US'],
    regions: [],
    localityNote: null,
    awardMin: null,
    awardMax: null,
    awardCurrency: 'USD',
    awardNotes: null,
    renewable: null,
    deadlineType: 'annual_window',
    effortLevel: 'unknown',
    verifiedAt: null,
    funder: null,
    cycles: [],
    requirements: [],
    ...partial,
  }
}

describe('cycleState', () => {
  it('is closed the instant the deadline passes, not at the end of that day', () => {
    // 11:59pm ET on 28 February 2027 is 04:59 UTC on 1 March.
    const deadline = new Date('2027-03-01T04:59:00Z')
    const c = cycle({ cycleYear: 2027, deadlineAt: deadline })
    expect(cycleState(c, new Date('2027-03-01T04:58:00Z'))).toBe('open')
    expect(cycleState(c, new Date('2027-03-01T05:00:00Z'))).toBe('closed')
  })

  it('treats a cycle that has not opened yet as upcoming', () => {
    const c = cycle({ cycleYear: 2027, opensAt: '2027-06-01', deadlineAt: new Date('2027-07-01T04:00:00Z') })
    expect(cycleState(c, new Date('2027-01-01T00:00:00Z'))).toBe('upcoming')
    expect(cycleState(c, new Date('2027-06-05T00:00:00Z'))).toBe('open')
  })

  it('falls back to the stored status only when there is no deadline', () => {
    expect(cycleState(cycle({ cycleYear: 2027, status: 'open' }), new Date())).toBe('open')
    expect(cycleState(cycle({ cycleYear: 2027, status: 'unknown' }), new Date())).toBe('unknown')
  })
})

describe('resolveNextCycle', () => {
  const now = new Date('2027-04-01T12:00:00Z')

  it('picks the nearest cycle still to close, not the newest year', () => {
    const g = grant({
      id: 'g1',
      cycles: [
        cycle({ cycleYear: 2028, deadlineAt: new Date('2028-03-01T05:00:00Z') }),
        cycle({ cycleYear: 2027, deadlineAt: new Date('2027-09-01T05:00:00Z') }),
      ],
    })
    expect(resolveNextCycle(g, now).cycle?.cycleYear).toBe(2027)
    expect(resolveNextCycle(g, now).state).toBe('open')
  })

  it('keeps the most recently closed cycle rather than resolving to nothing', () => {
    const g = grant({
      id: 'g2',
      cycles: [
        cycle({ cycleYear: 2025, deadlineAt: new Date('2025-03-01T05:00:00Z') }),
        cycle({ cycleYear: 2026, deadlineAt: new Date('2026-03-01T05:00:00Z') }),
      ],
    })
    const resolved = resolveNextCycle(g, now)
    expect(resolved.state).toBe('closed')
    expect(resolved.cycle?.cycleYear).toBe(2026)
  })

  it('counts days to the deadline as an instant, so it does not depend on the reader', () => {
    const g = grant({
      id: 'g3',
      cycles: [cycle({ cycleYear: 2027, deadlineAt: new Date('2027-04-11T12:00:00Z') })],
    })
    expect(resolveNextCycle(g, now).daysRemaining).toBe(10)
  })

  it('stays rolling even when the grant carries cycles', () => {
    const g = grant({
      id: 'g4',
      deadlineType: 'rolling',
      cycles: [cycle({ cycleYear: 2027, deadlineAt: new Date('2027-09-01T05:00:00Z') })],
    })
    expect(resolveNextCycle(g, now).state).toBe('rolling')
  })
})

describe('sortByUrgency', () => {
  it('orders open by soonest, then rolling, then unknown, then closed', () => {
    const now = new Date('2027-04-01T00:00:00Z')
    const soon = grant({ id: 'soon', cycles: [cycle({ cycleYear: 2027, deadlineAt: new Date('2027-04-10T00:00:00Z') })] })
    const later = grant({ id: 'later', cycles: [cycle({ cycleYear: 2027, deadlineAt: new Date('2027-08-10T00:00:00Z') })] })
    const rolling = grant({ id: 'rolling', deadlineType: 'rolling' })
    const unknown = grant({ id: 'unknown', deadlineType: 'unknown' })
    const closed = grant({ id: 'closed', cycles: [cycle({ cycleYear: 2026, deadlineAt: new Date('2026-04-10T00:00:00Z') })] })

    const order = sortByUrgency([closed, unknown, rolling, later, soon], now).map((g) => g.id)
    expect(order).toEqual(['soon', 'later', 'rolling', 'unknown', 'closed'])
  })
})

describe('matchesFilters', () => {
  const now = new Date('2027-04-01T00:00:00Z')

  it('keeps a national grant when a region filter is applied', () => {
    const g = grant({ id: 'national', geoScope: 'national', regions: [] })
    expect(matchesFilters(g, { regions: ['MI'] }, now)).toBe(true)
  })

  it('keeps a grant whose award size nobody has confirmed', () => {
    const g = grant({ id: 'no-amount', awardMin: null, awardMax: null })
    expect(matchesFilters(g, { awardMin: 1000, awardMax: 5000 }, now)).toBe(true)
  })

  it('lets a rolling grant through a deadline window', () => {
    const g = grant({ id: 'rolling', deadlineType: 'rolling' })
    expect(matchesFilters(g, { withinDays: 30 }, now)).toBe(true)
  })

  it('shows closed grants unless they are explicitly hidden', () => {
    const g = grant({ id: 'closed', cycles: [cycle({ cycleYear: 2026, deadlineAt: new Date('2026-04-10T00:00:00Z') })] })
    expect(matchesFilters(g, {}, now)).toBe(true)
    expect(matchesFilters(g, { hideClosed: true }, now)).toBe(false)
  })
})

describe('expectedNextWindow', () => {
  it('only projects an annual grant', () => {
    const fixed = grant({
      id: 'one-off',
      deadlineType: 'fixed',
      cycles: [cycle({ cycleYear: 2026, deadlineAt: new Date('2026-03-20T04:00:00Z') })],
    })
    expect(expectedNextWindow(fixed, new Date('2027-04-01T00:00:00Z'))).toBeNull()
  })

  it('names the same month next year once the last known deadline has passed', () => {
    const g = grant({
      id: 'annual',
      cycles: [cycle({ cycleYear: 2026, deadlineAt: new Date('2026-03-20T04:00:00Z') })],
    })
    expect(expectedNextWindow(g, new Date('2026-04-01T00:00:00Z'))).toBe('March 2027')
  })

  it('names this year when the anniversary is still ahead of us', () => {
    // Last known deadline 20 March 2026, and it is only 5 March 2027, so the
    // next window is this month, not next year. Comparing month numbers alone
    // would get this wrong in one direction or the other.
    const g = grant({
      id: 'annual',
      cycles: [cycle({ cycleYear: 2026, deadlineAt: new Date('2026-03-20T04:00:00Z') })],
    })
    expect(expectedNextWindow(g, new Date('2027-03-05T00:00:00Z'))).toBe('March 2027')
  })

  it('rolls past this year when the anniversary has already gone by', () => {
    const g = grant({
      id: 'annual',
      cycles: [cycle({ cycleYear: 2026, deadlineAt: new Date('2026-03-20T04:00:00Z') })],
    })
    expect(expectedNextWindow(g, new Date('2027-03-25T00:00:00Z'))).toBe('March 2028')
  })

  it('prefers a published deadline over one we estimated ourselves', () => {
    const g = grant({
      id: 'annual',
      cycles: [
        cycle({ cycleYear: 2026, deadlineAt: new Date('2026-03-20T04:00:00Z') }),
        cycle({ cycleYear: 2027, deadlineAt: new Date('2027-06-20T04:00:00Z'), isEstimated: true }),
      ],
    })
    // The June date is our own guess, so it must not become the basis of the
    // next guess. March is what the funder actually published.
    expect(expectedNextWindow(g, new Date('2027-04-01T00:00:00Z'))).toBe('March 2028')
  })
})

describe('formatDeadline', () => {
  it('renders one fixed zone with the zone named, so the date cannot slide', () => {
    // 04:59 UTC on 1 March is 11:59pm the evening before in New York, which is
    // the date the funder published.
    const text = formatDeadline(new Date('2027-03-01T04:59:00Z'))
    expect(text).toContain('28 Feb 2027')
    expect(text).toContain('EST')
  })
})
