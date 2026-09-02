/**
 * Competition days are not the same as days spanned.
 *
 * Off-season events routinely open with a day of load-in, move-in, pit hours,
 * inspection or practice matches only, and that day is not a day of
 * competition. Beach Blitz runs "Friday, October 30 - Sunday, November 1
 * (Friday load-in and practice matches in the late afternoon)" and is a
 * TWO-day event.
 *
 * Nothing asked for this before. The value was derived from the date span, so
 * a Friday-to-Sunday event came out as three, which the column does not allow,
 * and the listing was left blank instead.
 */
import { describe, it, expect } from 'bun:test'
import { validateEventRead } from '../src/listings/read-event.js'

const thread =
  'Dates: Friday, October 30 - Sunday, November 1, 2026 (Friday load-in and practices matches in the late afternoon)'
const sources = [{ source: 'thread', text: thread }]

describe('competition days', () => {
  it('keeps a two-day answer for a three-day span', () => {
    const { fields } = validateEventRead(
      {
        startDate: { value: '2026-10-30', quote: 'Friday, October 30 - Sunday, November 1, 2026' },
        endDate: { value: '2026-11-01', quote: 'Friday, October 30 - Sunday, November 1, 2026' },
        days: { value: 2, quote: 'Friday load-in and practices matches in the late afternoon' },
      },
      sources,
    )
    expect(fields.startDate).toBe('2026-10-30')
    expect(fields.endDate).toBe('2026-11-01')
    expect(fields.days).toBe(2)
  })

  it('throws away a days value that is really the span', () => {
    // Three is the shape of the mistake: it means the load-in was counted.
    const { fields, rejected } = validateEventRead(
      { days: { value: 3, quote: 'Friday, October 30 - Sunday, November 1, 2026' } },
      sources,
    )
    expect(fields.days).toBeUndefined()
    expect(rejected.join(' ')).toContain('counting the span')
  })

  it('still requires a quote for it', () => {
    const { fields } = validateEventRead({ days: { value: 2, quote: 'nothing anybody wrote' } }, sources)
    expect(fields.days).toBeUndefined()
  })
})
