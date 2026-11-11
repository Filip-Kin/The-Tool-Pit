/**
 * The reader keeps a fee in the currency the page charges in, and drops one it
 * cannot place (FIRST Israel's 2,000 shekels went up as $2,000, 2026-11-11).
 */
import { describe, it, expect } from 'bun:test'
import { validateEventRead } from '../src/listings/read-event.js'

const shekels = 'עלות ההשתתפות בתחרות לקבוצה: 2,000 ש"ח.'

describe('validateEventRead currency', () => {
  it('keeps shekels as shekels, whatever the model answered', () => {
    const { fields } = validateEventRead(
      { costUsd: { value: 2000, quote: shekels }, costCurrency: { value: 'USD', quote: shekels } },
      [{ source: 'https://firstisrael.org.il', text: shekels }],
      { country: 'IL' },
    )
    expect(fields.costUsd).toBe(2000)
    expect(fields.costCurrency).toBe('ILS')
  })

  it('reads a bare dollar by the listing country', () => {
    const q = 'Registration fee is $450 per team, per day'
    const { fields } = validateEventRead({ costUsd: { value: 450, quote: q } }, [{ source: 'https://stemleycup.ca', text: q }], { country: 'CA' })
    expect(fields.costCurrency).toBe('CAD')
  })

  it('drops a fee whose currency cannot be told', () => {
    const q = 'Entry is 300 per team'
    const { fields, rejected } = validateEventRead({ costUsd: { value: 300, quote: q } }, [{ source: 'https://example.org', text: q }], { country: 'US' })
    expect(fields.costUsd).toBeUndefined()
    expect(rejected.some((r) => r.startsWith('costUsd'))).toBe(true)
  })
})
