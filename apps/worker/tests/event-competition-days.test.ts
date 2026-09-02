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
import { looksLikeEventSite } from '../src/listings/connectors/shared.js'
import { teamNumbersOnPage } from '../src/listings/roster-refresh.js'

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

describe('the website field', () => {
  it('refuses a sign-up form', () => {
    // "Any link that is not the registration link" made a second form, a
    // Discord invite or a sponsor into the event's website by being second in
    // the list, which promises a reader a site and hands them a form.
    for (const url of [
      'https://docs.google.com/forms/d/e/1FAIpQLS/viewform',
      'https://forms.gle/abc123',
      'https://www.eventbrite.com/e/thing-tickets-123',
      'https://discord.gg/abcdef',
      'https://www.chiefdelphi.com/t/some-thread/123',
      'https://example.org/2026/register',
    ]) {
      expect(looksLikeEventSite(url)).toBe(false)
    }
  })

  it('accepts a real event site', () => {
    for (const url of ['https://beachblitz.org/', 'https://www.bordieblast.com', 'https://team1540.org/bunnybots']) {
      expect(looksLikeEventSite(url)).toBe(true)
    }
  })
})

describe('a specific link is more specific than the site', () => {
  const sources = [
    { source: 'thread', text: 'Midsummer Mayhem is at https://www.igknighters.org/midsummer-mayhem this year.' },
  ]

  it('drops a volunteer link that is only the website', () => {
    const { fields, rejected } = validateEventRead(
      {
        website: { value: 'https://www.igknighters.org/midsummer-mayhem', quote: 'https://www.igknighters.org/midsummer-mayhem' },
        volunteerUrl: { value: 'https://www.igknighters.org/midsummer-mayhem', quote: 'https://www.igknighters.org/midsummer-mayhem' },
      },
      sources,
    )
    expect(fields.website).toBe('https://www.igknighters.org/midsummer-mayhem')
    expect(fields.volunteerUrl).toBeUndefined()
    expect(rejected.join(' ')).toContain('that is the website')
  })

  it('drops a sign-up link that is a bare front page', () => {
    const { fields } = validateEventRead(
      { registrationUrl: { value: 'https://www.igknighters.org', quote: 'https://www.igknighters.org' } },
      [{ source: 'thread', text: 'see https://www.igknighters.org for details' }],
    )
    expect(fields.registrationUrl).toBeUndefined()
  })

  it('keeps a real sign-up page', () => {
    const { fields } = validateEventRead(
      {
        website: { value: 'https://www.igknighters.org/midsummer-mayhem', quote: 'https://www.igknighters.org/midsummer-mayhem' },
        volunteerUrl: { value: 'https://www.igknighters.org/midsummer-mayhem/volunteer', quote: 'https://www.igknighters.org/midsummer-mayhem/volunteer' },
      },
      [
        {
          source: 'site',
          text: 'https://www.igknighters.org/midsummer-mayhem https://www.igknighters.org/midsummer-mayhem/volunteer',
        },
      ],
    )
    expect(fields.volunteerUrl).toBe('https://www.igknighters.org/midsummer-mayhem/volunteer')
  })
})

describe('a team list read off a page', () => {
  it('needs enough numbers to be a list at all', () => {
    // Any page has numbers on it. A handful proves nothing.
    expect(teamNumbersOnPage('Doors open at 8, matches at 9, 2 fields, 1 winner')).toEqual([])
  })

  it('reads a real list', () => {
    const page = 'Registered Teams\n254\n1114\n2056\n118\n971\n1678\n3538\n5406\n4907'
    expect(teamNumbersOnPage(page)).toEqual([118, 254, 971, 1114, 1678, 2056, 3538, 4907, 5406])
  })

  it('drops the season year, which is on every one of these pages', () => {
    const page = '2026 Teams\n254\n1114\n2056\n118\n971\n1678\n3538\n5406\n2026'
    // Team 2026 exists, and losing it is the right way to be wrong here: the
    // number appears as a year on every page of this kind.
    expect(teamNumbersOnPage(page, 2026)).not.toContain(2026)
  })
})

describe('teamListUrl is the event own page', () => {
  const sources = [{ source: 'thread', text: 'Chezy Champs at https://chezychamps.com this year' }]
  it('drops a Blue Alliance link', () => {
    const { fields, rejected } = validateEventRead(
      {
        website: { value: 'https://chezychamps.com', quote: 'https://chezychamps.com' },
        teamListUrl: { value: 'https://www.thebluealliance.com/event/2026cc', quote: 'https://www.thebluealliance.com/event/2026cc' },
      },
      [...sources, { source: 'site', text: 'https://www.thebluealliance.com/event/2026cc' }],
    )
    expect(fields.teamListUrl).toBeUndefined()
    expect(rejected.join(' ')).toContain('Blue Alliance')
  })
})

describe('a redundant cost note', () => {
  it('is dropped when it only restates free', () => {
    const { fields } = validateEventRead(
      {
        costUsd: { value: 0, quote: 'free and open to the public' },
        costNote: { value: 'Free and open to the public', quote: 'free and open to the public' },
      },
      [{ source: 'thread', text: 'This event is free and open to the public.' }],
    )
    expect(fields.costUsd).toBe(0)
    expect(fields.costNote).toBeUndefined()
  })

  it('is kept when it says something the number does not', () => {
    const { fields } = validateEventRead(
      {
        costUsd: { value: 400, quote: '$400 per team' },
        costNote: { value: '$600 for a field-side pit', quote: '$600 for a field-side pit' },
      },
      [{ source: 'thread', text: '$400 per team, or $600 for a field-side pit.' }],
    )
    expect(fields.costNote).toBe('$600 for a field-side pit')
  })
})
