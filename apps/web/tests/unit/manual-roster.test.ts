import { describe, it, expect } from 'vitest'
// Imported from source, not the built barrel: this is a pure, zero-dependency
// function, so the test needs no db build to run.
import { parseManualRoster } from '../../../../packages/db/src/manual-roster'

/**
 * The manual team-list parser: an owner types their roster into a textarea and
 * this turns it into the same { number, robot, name } entries a scrape produces.
 *
 * The two failures these tests exist to pin are the two the feature must never
 * have: a NAME read as a team number, and a SLOT INDEX read as a team number.
 */
describe('parseManualRoster', () => {
  it('reads a bare team number', () => {
    expect(parseManualRoster('254')).toEqual([{ number: 254, robot: null }])
  })

  it('reads a team number and keeps the name, and does NOT read the name as a robot', () => {
    expect(parseManualRoster('254 The Cheesy Poofs')).toEqual([
      { number: 254, robot: null, name: 'The Cheesy Poofs' },
    ])
  })

  it('reads a B team in the canonical no-space form 4145B', () => {
    expect(parseManualRoster('4145B')).toEqual([{ number: 4145, robot: 'B' }])
  })

  it('tolerates a stray space or dash: 4145 B and 4145-B are the same B team', () => {
    expect(parseManualRoster('4145 B')).toEqual([{ number: 4145, robot: 'B' }])
    expect(parseManualRoster('4145-B')).toEqual([{ number: 4145, robot: 'B' }])
  })

  it('reads a C team, spaced or glued, and uppercases the letter', () => {
    expect(parseManualRoster('503 C')).toEqual([{ number: 503, robot: 'C' }])
    expect(parseManualRoster('503c')).toEqual([{ number: 503, robot: 'C' }])
  })

  it('reads a B team that also carries a name', () => {
    expect(parseManualRoster('4145B The Bionic Barons')).toEqual([
      { number: 4145, robot: 'B', name: 'The Bionic Barons' },
    ])
  })

  it('splits on newlines and ignores blank lines and surrounding whitespace', () => {
    expect(parseManualRoster('  254\n\n1114 \n\n  2056  ')).toEqual([
      { number: 254, robot: null },
      { number: 1114, robot: null },
      { number: 2056, robot: null },
    ])
  })

  it('splits a comma-separated line into several teams', () => {
    expect(parseManualRoster('254, 1114, 2056')).toEqual([
      { number: 254, robot: null },
      { number: 1114, robot: null },
      { number: 2056, robot: null },
    ])
  })

  it('skips a line that is only text: a name is never read as a team number', () => {
    expect(parseManualRoster('Registered Teams')).toEqual([])
    expect(parseManualRoster('The Cheesy Poofs')).toEqual([])
  })

  it('ignores stray headings mixed in with real teams', () => {
    const text = ['Teams so far:', '254', '', '1114 The Simbotics', 'more to come'].join('\n')
    expect(parseManualRoster(text)).toEqual([
      { number: 254, robot: null },
      { number: 1114, robot: null, name: 'The Simbotics' },
    ])
  })

  it('reads the team, not the slot, from a "slot - team" bracket line', () => {
    expect(parseManualRoster('6 - 4145')).toEqual([{ number: 4145, robot: null }])
    expect(parseManualRoster('6 - 4145 B')).toEqual([{ number: 4145, robot: 'B' }])
  })

  it('never keeps a second bare number as a name', () => {
    // "254 1114" is not two teams and 1114 is not team 254's name: a name has to
    // have letters in it, so the digits are dropped rather than misfiled.
    expect(parseManualRoster('254 1114')).toEqual([{ number: 254, robot: null }])
  })

  it('drops a duplicate team, matching on number and robot', () => {
    expect(parseManualRoster('254\n254\n254 The Cheesy Poofs')).toEqual([{ number: 254, robot: null }])
  })

  it('keeps a team and its B team as two distinct entries', () => {
    expect(parseManualRoster('4145\n4145B')).toEqual([
      { number: 4145, robot: null },
      { number: 4145, robot: 'B' },
    ])
  })

  it('sorts by team number then robot letter regardless of typed order', () => {
    expect(parseManualRoster('1114\n254B\n254')).toEqual([
      { number: 254, robot: null },
      { number: 254, robot: 'B' },
      { number: 1114, robot: null },
    ])
  })

  it('rejects a zero and out-of-range numbers', () => {
    expect(parseManualRoster('0\n0 Some Team')).toEqual([])
  })

  it('returns nothing for empty or whitespace-only input', () => {
    expect(parseManualRoster('')).toEqual([])
    expect(parseManualRoster('   \n\n  ')).toEqual([])
    expect(parseManualRoster(null)).toEqual([])
    expect(parseManualRoster(undefined)).toEqual([])
  })

  it('reads a realistic mixed list end to end', () => {
    const text = [
      '254 The Cheesy Poofs',
      '4145B',
      '1114, 2056',
      '',
      '6 - 4611',
      'Waitlist below',
    ].join('\n')
    expect(parseManualRoster(text)).toEqual([
      { number: 254, robot: null, name: 'The Cheesy Poofs' },
      { number: 1114, robot: null },
      { number: 2056, robot: null },
      { number: 4145, robot: 'B' },
      { number: 4611, robot: null },
    ])
  })
})
