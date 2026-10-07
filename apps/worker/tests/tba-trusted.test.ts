import { describe, expect, it } from 'vitest'
import { demoNumberFor, tbaTeamKeys } from '../src/connectors/tba-trusted.js'

describe('demoNumberFor', () => {
  it('uses the last two digits when they fall in the demo range', () => {
    expect(demoNumberFor(8280)).toBe(9980)
    expect(demoNumberFor(1299)).toBe(9999)
    expect(demoNumberFor(70)).toBe(9970)
  })
  it('falls back to the last digit otherwise', () => {
    expect(demoNumberFor(1701)).toBe(9991)
    expect(demoNumberFor(5144)).toBe(9994)
    expect(demoNumberFor(254)).toBe(9994)
  })
})

describe('tbaTeamKeys', () => {
  it('leaves a plain roster alone', () => {
    const r = tbaTeamKeys([{ number: 254 }, { number: 1114, robot: null }])
    expect(r).toEqual({ keys: ['frc254', 'frc1114'], remap: {}, dropped: [] })
  })
  it('sends a B team as its demo number and remaps it back', () => {
    const r = tbaTeamKeys([{ number: 8280 }, { number: 8280, robot: 'B' }, { number: 123 }])
    expect(r.keys).toEqual(['frc123', 'frc8280', 'frc9980'])
    expect(r.remap).toEqual({ frc9980: 'frc8280B' })
  })
  it('matches what C3 2026 was pushed by hand', () => {
    const r = tbaTeamKeys([
      { number: 1701 }, { number: 1701, robot: 'b' },
      { number: 5144 }, { number: 5144, robot: 'B' },
      { number: 8280 }, { number: 8280, robot: 'B' },
    ])
    expect(r.remap).toEqual({ frc9991: 'frc1701B', frc9994: 'frc5144B', frc9980: 'frc8280B' })
    expect(r.keys).toContain('frc9991')
  })
  it('walks to the next free demo number on a collision', () => {
    const r = tbaTeamKeys([{ number: 1701, robot: 'B' }, { number: 5141, robot: 'B' }, { number: 9992 }])
    expect(r.remap).toEqual({ frc9991: 'frc1701B', frc9993: 'frc5141B' })
    expect([...r.keys].sort()).toEqual(['frc9991', 'frc9992', 'frc9993'])
  })
  it('wraps from 9999 back to 9970', () => {
    const r = tbaTeamKeys([{ number: 1299, robot: 'B' }, { number: 4399, robot: 'B' }])
    expect(r.remap).toEqual({ frc9999: 'frc1299B', frc9970: 'frc4399B' })
  })
})
