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
