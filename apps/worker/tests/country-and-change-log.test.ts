import { describe, it, expect } from 'bun:test'
import { normaliseCountry, normaliseCountries, countryName, placeLine } from '@the-tool-pit/db/country'
import { planRevert, sameStoredValue } from '../src/listings/change-log.js'

describe('normaliseCountry', () => {
  it.each([
    ['US', 'US'], ['us', 'US'], ['USA', 'US'], ['U.S.A.', 'US'], ['United States', 'US'], ['United States of America', 'US'],
    ['CA', 'CA'], ['Canada', 'CA'], ['MX', 'MX'], ['Mexico', 'MX'], ['AU', 'AU'], ['Australia', 'AU'],
    ['TR', 'TR'], ['Turkey', 'TR'], ['Türkiye', 'TR'], ['Turkiye', 'TR'], ['CN', 'CN'], ['China', 'CN'],
    ['TW', 'TW'], ['Taiwan', 'TW'], ['Chinese Taipei', 'TW'], ['IL', 'IL'], ['Israel', 'IL'],
    ['GB', 'GB'], ['UK', 'GB'], ['uk', 'GB'], ['United Kingdom', 'GB'],
  ])('%s -> %s', (input, code) => {
    expect(normaliseCountry(input)).toBe(code)
  })

  it('upper-cases an unknown two-letter value and passes anything else through', () => {
    expect(normaliseCountry('fi')).toBe('FI')
    expect(normaliseCountry('  Deutschland ')).toBe('Deutschland')
    expect(normaliseCountry('')).toBeNull()
    expect(normaliseCountry(null)).toBeNull()
  })

  it('normalises a grant country list, deduped in order', () => {
    expect(normaliseCountries(['USA', 'US', 'UK', 'Canada'])).toEqual(['US', 'GB', 'CA'])
  })
})

describe('location line', () => {
  it('omits the US', () => {
    expect(placeLine(['Detroit', 'MI'], 'US')).toBe('Detroit, MI')
    expect(placeLine(['Detroit', 'MI'], 'United States')).toBe('Detroit, MI')
  })
  it('names other countries in English', () => {
    expect(placeLine(['Toronto', 'ON'], 'CA')).toBe('Toronto, ON, Canada')
    expect(countryName('GB')).toBe('United Kingdom')
  })
})

const at = (iso: string) => new Date(iso)

describe('planRevert', () => {
  const base = { entityType: 'field', entityId: 'f1', column: 'country' }

  it('restores the latest change when the column still holds its new value', () => {
    const steps = planRevert(
      [
        { ...base, id: 'a', oldValue: 'United States', newValue: 'US', createdAt: at('2026-10-01T10:00:00Z') },
        { ...base, id: 'b', oldValue: 'US', newValue: 'CA', createdAt: at('2026-10-08T10:00:00Z') },
      ],
      new Map([['field:f1', { country: 'CA' }]]),
    )
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ action: 'restore', change: { id: 'b', oldValue: 'US' } })
  })

  it('leaves a column a person changed since', () => {
    const steps = planRevert(
      [{ ...base, id: 'a', oldValue: 'Slice', newValue: 'SLICE Robotics', createdAt: at('2026-10-01T10:00:00Z'), column: 'teamName' }],
      new Map([['field:f1', { teamName: 'Slice 5422' }]]),
    )
    expect(steps[0]!.action).toBe('changed_since')
  })

  it('reports a listing that is gone', () => {
    const steps = planRevert(
      [{ ...base, id: 'a', oldValue: null, newValue: 'x', createdAt: at('2026-10-01T10:00:00Z') }],
      new Map(),
    )
    expect(steps[0]!.action).toBe('entity_gone')
  })

  it('compares dates and numbers as stored', () => {
    expect(sameStoredValue(new Date('2026-10-01T00:00:00Z'), '2026-10-01T00:00:00.000Z')).toBe(true)
    expect(sameStoredValue('24.0', 24)).toBe(true)
    expect(sameStoredValue(null, '')).toBe(true)
    expect(sameStoredValue('a', 'b')).toBe(false)
  })
})
