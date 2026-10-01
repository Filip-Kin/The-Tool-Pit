/**
 * The deterministic half of the weekly cancellation watch: the pre-check that
 * decides whether a page is worth a model call, the quote check that decides
 * whether the model's answer is evidence, and which listings are watched.
 */
import { describe, it, expect } from 'bun:test'
import {
  cancellationHits,
  isWatchable,
  parseVerdict,
  quoteVerified,
  watchDedupeKey,
} from '../src/listings/event-status-watch.js'

// The real page, 2026-09-25.
const BLUE_STREAKS = `Blue Streak Blitz
Home  Schedule  Teams
2026 Canceled
Unfortunately this year's Blue Streak Blitz is Canceled.
Thank you to every team that registered.`

describe('cancellationHits', () => {
  it('catches the Blue Streaks Blitz notice', () => {
    const hits = cancellationHits(BLUE_STREAKS)
    expect(hits).toContain("Unfortunately this year's Blue Streak Blitz is Canceled.")
    expect(hits).toContain('2026 Canceled')
  })

  it('catches postponed and rescheduled', () => {
    expect(cancellationHits('The Bot Bash is postponed to November 8.')).toHaveLength(1)
    expect(cancellationHits('Rumble at the Rock has been rescheduled for October 18.')).toHaveLength(1)
  })

  it('ignores policy and conditional wording', () => {
    const policy = [
      'Cancellation policy: registration fees are non-refundable.',
      'If the event is cancelled due to weather, fees will be refunded.',
      'In the event of a cancellation, teams will be notified by email.',
      'In case of cancellation we will post here.',
      'The competition may be postponed for snow.',
      'Refunds are issued if a team is cancelled before October 1.',
    ].join('\n')
    expect(cancellationHits(policy)).toEqual([])
  })

  it('ignores a page with no status words, and a bare Cancel button', () => {
    expect(cancellationHits('Register now. Teams: 254, 1678. Cancel and close')).toEqual([])
  })
})

describe('quoteVerified', () => {
  it('accepts a verbatim quote, whitespace and curly quotes folded', () => {
    expect(quoteVerified('Unfortunately this year’s Blue Streak  Blitz is Canceled.', BLUE_STREAKS)).toBe(true)
  })

  it('rejects a paraphrase', () => {
    expect(quoteVerified('Blue Streak Blitz has been cancelled this year.', BLUE_STREAKS)).toBe(false)
  })

  it('rejects a quote that is on the page but says nothing about a cancellation', () => {
    expect(quoteVerified('Thank you to every team that registered.', BLUE_STREAKS)).toBe(false)
  })

  it('rejects an empty or too-short quote', () => {
    expect(quoteVerified('', BLUE_STREAKS)).toBe(false)
    expect(quoteVerified('Canceled', BLUE_STREAKS)).toBe(false)
  })
})

describe('parseVerdict', () => {
  it('reads the JSON answer, fenced or not', () => {
    expect(parseVerdict('{"status":"cancelled","quote":"X is Canceled."}')).toEqual({ status: 'cancelled', quote: 'X is Canceled.' })
    expect(parseVerdict('```json\n{"status":"none","quote":""}\n```')).toEqual({ status: 'none', quote: '' })
  })

  it('rejects an unknown status or no JSON', () => {
    expect(parseVerdict('{"status":"maybe","quote":"x"}')).toBeNull()
    expect(parseVerdict('cancelled')).toBeNull()
  })
})

describe('isWatchable', () => {
  const TODAY = '2026-09-30'
  const base = { status: 'published', eventStatus: 'confirmed', startDate: '2026-10-10' }

  it('watches upcoming published tentative and confirmed events', () => {
    expect(isWatchable(base, TODAY)).toBe(true)
    expect(isWatchable({ ...base, eventStatus: 'tentative' }, TODAY)).toBe(true)
  })

  it('watches an event that started up to three days ago', () => {
    expect(isWatchable({ ...base, startDate: '2026-09-27' }, TODAY)).toBe(true)
    expect(isWatchable({ ...base, startDate: '2026-09-26' }, TODAY)).toBe(false)
  })

  it('skips cancelled, completed, unpublished and undated listings', () => {
    expect(isWatchable({ ...base, eventStatus: 'cancelled' }, TODAY)).toBe(false)
    expect(isWatchable({ ...base, eventStatus: 'completed' }, TODAY)).toBe(false)
    expect(isWatchable({ ...base, status: 'pending' }, TODAY)).toBe(false)
    expect(isWatchable({ ...base, startDate: null }, TODAY)).toBe(false)
  })
})

describe('watchDedupeKey', () => {
  it('is the same for the same quote however it is spaced or cased', () => {
    expect(watchDedupeKey('a', 'cancelled', 'X is  Canceled.')).toBe(watchDedupeKey('a', 'cancelled', 'x is canceled.'))
  })

  it('differs by listing, verdict and quote', () => {
    const k = watchDedupeKey('a', 'cancelled', 'X is Canceled.')
    expect(watchDedupeKey('b', 'cancelled', 'X is Canceled.')).not.toBe(k)
    expect(watchDedupeKey('a', 'postponed', 'X is Canceled.')).not.toBe(k)
    expect(watchDedupeKey('a', 'cancelled', 'Y is Canceled.')).not.toBe(k)
  })
})
