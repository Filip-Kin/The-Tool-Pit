/**
 * Countries are stored as ISO codes. A location line leaves the US off and
 * writes any other country out in English.
 */
import { describe, it, expect } from 'bun:test'
import { fieldLocation } from '@/lib/fields/field-display'
import { eventLocation, eventAddressLine } from '@/lib/events/event-display'
import { normaliseCountries } from '@the-tool-pit/db/country'

describe('fieldLocation', () => {
  it('omits US', () => {
    expect(fieldLocation({ city: 'Hemlock', region: 'MI', country: 'US' })).toBe('Hemlock, MI')
  })
  it('names other countries', () => {
    expect(fieldLocation({ city: 'Toronto', region: 'ON', country: 'CA' })).toBe('Toronto, ON, Canada')
    expect(fieldLocation({ city: 'Istanbul', region: null, country: 'TR' })).toBe('Istanbul, Türkiye')
  })
  it('handles an old spelled-out value', () => {
    expect(fieldLocation({ city: 'Rutland', region: 'VT', country: 'United States' })).toBe('Rutland, VT')
  })
  it('is empty with nothing', () => {
    expect(fieldLocation({ city: null, region: null, country: null })).toBe('')
  })
})

describe('eventLocation', () => {
  it('venue first, US omitted', () => {
    expect(eventLocation({ venueName: 'Ford Field', city: 'Detroit', region: 'MI', country: 'US' })).toBe('Ford Field, Detroit, MI')
  })
  it('full address line with a non-US country', () => {
    expect(eventAddressLine({ address: '1 Main St', city: 'Haifa', region: null, country: 'IL' })).toBe('1 Main St, Haifa, Israel')
  })
})

describe('grant countries', () => {
  it('UK is GB', () => {
    expect(normaliseCountries(['UK', 'us'])).toEqual(['GB', 'US'])
  })
})
