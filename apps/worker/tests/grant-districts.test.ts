import { describe, it, expect } from 'vitest'
import { districtsOf } from '../src/grants/districts.js'

// TBA's 2027 list, as /districts/2027 returned it on 2026-11-11.
const list = [
  ['ca', 'FIRST California'], ['fch', 'FIRST Chesapeake'], ['fim', 'FIRST in Michigan'], ['fin', 'FIRST Indiana Robotics'],
  ['fit', 'FIRST In Texas'], ['fma', 'FIRST Mid-Atlantic'], ['fnc', 'FIRST North Carolina'], ['fsc', 'FIRST South Carolina'],
  ['isr', 'FIRST Israel'], ['ne', 'New England'], ['ont', 'FIRST Canada - Ontario'], ['pch', 'Peachtree'],
  ['pnw', 'Pacific Northwest'], ['tx', 'FIRST In Texas'], ['win', 'FIRST Wisconsin'],
].map(([code, name]) => ({ code, name }))

describe('districtsOf', () => {
  it('knows a district funder', () => {
    expect(districtsOf({ funderName: 'FIRST Mid-Atlantic' }, list)?.codes).toEqual(['fma'])
    expect(districtsOf({ funderName: 'FIRST Wisconsin' }, list)?.codes).toEqual(['win'])
    expect(districtsOf({ funderName: 'FIRST Indiana' }, list)?.codes).toEqual(['fin'])
    expect(districtsOf({ funderName: 'FIRST Texas' }, list)?.codes).toEqual(['fit', 'tx'])
    expect(districtsOf({ funderName: 'FIRST in Michigan' }, list)?.codes).toEqual(['fim'])
  })
  it('reads "<district> District" in the grant text', () => {
    expect(districtsOf({ funderName: 'Some Bank', texts: ['FRC teams in the FIRST Mid-Atlantic District can apply'] }, list)?.codes).toEqual(['fma'])
  })
  it('does not take FIRST headquarters or a company for a district', () => {
    expect(districtsOf({ funderName: 'FIRST (For Inspiration and Recognition of Science and Technology)' }, list)).toBeNull()
    expect(districtsOf({ funderName: 'Texas Instruments' }, list)).toBeNull()
    expect(districtsOf({ funderName: 'Michigan Economic Development Corporation' }, list)).toBeNull()
    expect(districtsOf({ funderName: 'Toyota', texts: ['teams in Texas and Indiana'] }, list)).toBeNull()
  })
})
