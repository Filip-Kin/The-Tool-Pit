/**
 * When the "Team list unreadable" alert may go out: only when NO parser gives
 * a sane roster. FIRST Chance, 2026-09-30: the stored parser still read 12
 * teams while the 3-day re-proof gave up, and the alert it posted was false.
 */
import { describe, it, expect } from 'bun:test'
import { reproofOutcome, eventIsOver } from '../src/listings/roster-refresh.js'
import type { RosterTeam } from '@the-tool-pit/db'

const t = (...nums: number[]): RosterTeam[] => nums.map((number) => ({ number, robot: null }))
const TWELVE = t(254, 1678, 1114, 2056, 118, 148, 971, 973, 1323, 4414, 6328, 3476)

describe('reproofOutcome', () => {
  it('takes a sane fresh parser, no alert', () => {
    expect(reproofOutcome(TWELVE, TWELVE, null)).toEqual({ use: 'fresh', alert: false })
  })

  it('falls back to a stored parser that still reads sanely, no alert', () => {
    expect(reproofOutcome(TWELVE, null, { ok: true, teams: TWELVE })).toEqual({ use: 'stored', alert: false })
  })

  it('falls back to the stored parser when the fresh one is suspect, no alert', () => {
    expect(reproofOutcome(TWELVE, t(1, 2, 3, 4, 5, 6), { ok: true, teams: TWELVE })).toEqual({ use: 'stored', alert: false })
  })

  it('alerts only when neither the fresh nor the stored parser gives a sane roster', () => {
    expect(reproofOutcome(TWELVE, null, { ok: false, error: 'parser found no teams on any frame' })).toEqual({
      use: 'none',
      alert: true,
    })
    expect(reproofOutcome(TWELVE, t(1, 2, 3, 4, 5), { ok: true, teams: t(254) })).toEqual({ use: 'none', alert: true })
  })

  it('does not count a stored parser that was never run as sane', () => {
    expect(reproofOutcome(TWELVE, null, null)).toEqual({ use: 'none', alert: true })
  })
})

describe('eventIsOver', () => {
  it('is over the day after the end date, else the start date', () => {
    expect(eventIsOver({ startDate: '2026-09-20', endDate: '2026-09-21' }, '2026-09-21')).toBe(false)
    expect(eventIsOver({ startDate: '2026-09-20', endDate: '2026-09-21' }, '2026-09-22')).toBe(true)
    expect(eventIsOver({ startDate: '2026-09-25', endDate: null }, '2026-09-26')).toBe(true)
    expect(eventIsOver({ startDate: null, endDate: null }, '2026-09-26')).toBe(false)
  })
})

describe('reproofOutcome: a proven fresh parser beats a bad baseline', () => {
  it('uses a fresh read even when it shares little with the old baseline', () => {
    const baseline = [2025, 1540, 2374].map((n) => ({ number: n, robot: null }))
    const fresh = [955, 957, 1359, 1425, 1540, 2374, 2471, 2521].map((n) => ({ number: n, robot: null }))
    const storedJunk = { ok: true as const, teams: [1, 4, 6, 7, 8, 9, 1540, 2374, 2025].map((n) => ({ number: n, robot: null })) }
    expect(reproofOutcome(baseline, fresh, storedJunk)).toEqual({ use: 'fresh', alert: false })
  })
})
