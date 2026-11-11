import { describe, it, expect } from 'bun:test'
import { currencyOf } from '../src/listings/currency.js'

describe('currencyOf', () => {
  it('reads shekels from Hebrew', () => {
    expect(currencyOf('עלות ההשתתפות בתחרות לקבוצה: 2,000 ש"ח.', 'IL')).toBe('ILS')
  })
  it('reads a bare dollar by country', () => {
    expect(currencyOf('Registration is $200 per team', 'US')).toBe('USD')
    expect(currencyOf('Registration fee is $450 per team, per day', 'CA')).toBe('CAD')
    expect(currencyOf('Entry $300', 'AU')).toBe('AUD')
    expect(currencyOf('Entry $300', 'IL')).toBeNull()
  })
  it('lets a code beat the country', () => {
    expect(currencyOf('CAD$450 per team', 'CA')).toBe('CAD')
    expect(currencyOf('US$300 per team', 'CA')).toBe('USD')
    expect(currencyOf('$300 USD per team', 'CA')).toBe('USD')
    expect(currencyOf('450 CAD per team', 'US')).toBe('CAD')
    expect(currencyOf('€150 per team', 'US')).toBe('EUR')
  })
  it('does not read words as currency codes', () => {
    expect(currencyOf('Bring CAD files, $50 per team', 'US')).toBe('USD')
    expect(currencyOf('Try the $75 practice slot', 'US')).toBe('USD')
  })
  it('is null with no price marker or two currencies', () => {
    expect(currencyOf('2,000 per team', 'US')).toBeNull()
    expect(currencyOf('$300 USD or 400 CAD', 'CA')).toBeNull()
  })
})
