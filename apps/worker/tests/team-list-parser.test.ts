/**
 * The pure logic behind the model-authored team-list parsers.
 *
 * A parser runs in the browser and needs a page, so it is not unit-tested here.
 * What IS testable without a browser is what guards it: the check that catches a
 * slot column read as team numbers, the coercion that turns a parser's raw
 * output into validated teams, and the detector that decides a stored parser has
 * broken and must be rewritten. Those are where a wrong roster gets published.
 */
import { describe, it, expect } from 'bun:test'
import { slotIndicesLeaked, normaliseTeams } from '../src/listings/team-list-parser.js'
import { suspectRosterChange } from '../src/listings/roster-refresh.js'
import type { RosterTeam } from '@the-tool-pit/db'

const teams = (...nums: number[]): RosterTeam[] => nums.map((number) => ({ number }))

describe('slotIndicesLeaked', () => {
  it('flags a run of small consecutive numbers from one', () => {
    // MARC's Wix table leaks its 1..16 position column beside the real teams.
    expect(slotIndicesLeaked(teams(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16))).toBe('1 through 16')
  })

  it('flags the shortest run it will act on', () => {
    expect(slotIndicesLeaked(teams(1, 2, 3, 4, 5, 254, 1114))).toBe('1 through 5')
  })

  it('flags a run of past-season years', () => {
    // MARC lists its past seasons (2007..2017) beside the real table, and they
    // read as team numbers just as easily as a slot column does.
    expect(slotIndicesLeaked(teams(2007, 2008, 2009, 2010, 2011, 2012, 2013))).toBe('2007 through 2013')
  })

  it('leaves real team numbers alone', () => {
    expect(slotIndicesLeaked(teams(88, 131, 254, 503, 4145, 8728))).toBeNull()
  })

  it('does not flag a run too short to be a column', () => {
    // Four low numbers is not enough to be sure it is a slot column; the
    // suspect-change detector catches that case against the previous roster.
    expect(slotIndicesLeaked(teams(1, 2, 3, 4))).toBeNull()
  })
})

describe('normaliseTeams', () => {
  it('reads bare strings, including a second robot', () => {
    const out = normaliseTeams(['4145', '4145 B'])
    expect(out).toEqual([
      { number: 4145, robot: null },
      { number: 4145, robot: 'B' },
    ])
  })

  it('reads the structured object form', () => {
    const out = normaliseTeams([
      { number: 254, robot: null },
      { number: 100, robot: null },
    ])
    expect(out.map((t) => t.number)).toEqual([100, 254])
  })

  it('drops garbage entries', () => {
    const out = normaliseTeams(['not a team', { number: 0 }, { number: 999_999 }, null, {}, { number: 254 }])
    expect(out).toEqual([{ number: 254, robot: null }])
  })

  it('sorts registered teams before the waitlist, in order', () => {
    const out = normaliseTeams([
      { number: 900, robot: null, waitlisted: true, waitlistPosition: 2 },
      { number: 254, robot: null },
      { number: 800, robot: null, waitlisted: true, waitlistPosition: 1 },
      { number: 100, robot: null },
    ])
    expect(out.map((t) => t.number)).toEqual([100, 254, 800, 900])
    expect(out.filter((t) => t.waitlisted).map((t) => t.number)).toEqual([800, 900])
  })
})

describe('suspectRosterChange', () => {
  it('flags a leaked slot column', () => {
    const next = teams(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
    expect(suspectRosterChange(teams(503, 247, 8728), next).suspect).toBe(true)
  })

  it('flags an empty result when the last roster was not empty', () => {
    expect(suspectRosterChange(teams(503, 247), []).suspect).toBe(true)
  })

  it('flags most of the known teams vanishing at once', () => {
    // The owner's example: [503, 247, 8728, 226] turning into [1, 2, 3, 4].
    const out = suspectRosterChange(teams(503, 247, 8728, 226), teams(1, 2, 3, 4))
    expect(out.suspect).toBe(true)
  })

  it('accepts a roster that grew but kept every old team', () => {
    const out = suspectRosterChange(teams(503, 247), teams(503, 247, 999, 1114))
    expect(out.suspect).toBe(false)
  })

  it('accepts a roster where most teams stayed', () => {
    // Three of four remain, one dropped out. A normal registration change.
    const out = suspectRosterChange(teams(503, 247, 8728, 226), teams(503, 247, 8728, 4145))
    expect(out.suspect).toBe(false)
  })

  it('never flags the first run, when there is no previous roster', () => {
    expect(suspectRosterChange([], teams(503, 247)).suspect).toBe(false)
  })
})

describe('slotIndicesLeaked catches non-step-1 leaks', () => {
  const t = (nums: number[]) => nums.map((number) => ({ number }))
  it('catches the CORI even-slot leak', () => {
    // Real teams plus the even slots 16..32 the prod parser once leaked.
    const teams = t([16, 18, 20, 22, 24, 26, 28, 30, 32, 48, 144, 379, 4145, 10011])
    expect(slotIndicesLeaked(teams)).not.toBeNull()
  })
  it('does not flag a real CORI roster', () => {
    expect(slotIndicesLeaked(t([48, 144, 379, 1317, 3814, 4121, 4145, 4269, 4611, 6964, 10011]))).toBeNull()
  })
  it('does not flag RiverRage', () => {
    expect(slotIndicesLeaked(t([88, 131, 151, 166, 190, 238, 246, 319, 501, 811, 1058]))).toBeNull()
  })
  it('does not flag a handful of real low-numbered teams', () => {
    // 16, 27, 33, 45 are all real active teams; they are not an even run.
    expect(slotIndicesLeaked(t([16, 27, 33, 45, 254, 1114]))).toBeNull()
  })
})
