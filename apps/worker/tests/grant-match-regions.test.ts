/**
 * A grant that lists states is limited to them, whatever its scope says.
 * Toyota, Rockwell and SC Johnson were stored national with their operating
 * states listed, and their alerts went to every US team (2026-11-11 audit).
 */
import { describe, expect, it } from 'vitest'
import { matchProfileToGrant } from '../src/grants/matcher.js'

const profile = (region: string) => ({ program: 'frc', country: 'US', region }) as never
const grant = (geoScope: string, regions: string[]) =>
  ({ geoScope, countries: ['US'], regions, programs: ['frc'], localityNote: null }) as never

describe('regions on the listing', () => {
  it('rules out a team outside the states a national grant lists', () => {
    expect(matchProfileToGrant(profile('CA'), grant('national', ['AL', 'TX']), [], null).verdict).toBe('ineligible')
    expect(matchProfileToGrant(profile('TX'), grant('national', ['AL', 'TX']), [], null).verdict).not.toBe('ineligible')
  })

  it('leaves a national grant with no states open to every US team', () => {
    expect(matchProfileToGrant(profile('CA'), grant('national', []), [], null).verdict).not.toBe('ineligible')
  })

  it('rules out a team outside a region grant', () => {
    expect(matchProfileToGrant(profile('MI'), grant('region', ['NJ', 'PA', 'DE']), [], null).verdict).toBe('ineligible')
  })
})

describe('FIRST district grants', () => {
  const fma = { geoScope: 'region', countries: ['US'], regions: ['NJ', 'PA', 'DE'], firstDistricts: ['fma'], programs: ['frc'], localityNote: null } as never
  const team = (region: string, district: string | null | undefined) => ({ program: 'frc', country: 'US', region, district }) as never

  it('matches a team in the district', () => {
    expect(matchProfileToGrant(team('PA', 'fma'), fma, [], null).verdict).not.toBe('ineligible')
  })
  it('rules out a western Pennsylvania team in no district', () => {
    expect(matchProfileToGrant(team('PA', null), fma, [], null).verdict).toBe('ineligible')
  })
  it('rules out a Michigan team', () => {
    expect(matchProfileToGrant(team('MI', 'fim'), fma, [], null).verdict).toBe('ineligible')
  })
  it('leaves a team TBA has not placed to the region check', () => {
    expect(matchProfileToGrant(team('NJ', undefined), fma, [], null).verdict).toBe('likely')
    expect(matchProfileToGrant(team('MI', undefined), fma, [], null).verdict).toBe('ineligible')
  })
})
