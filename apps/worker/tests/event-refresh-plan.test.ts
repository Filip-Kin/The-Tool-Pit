/**
 * The weekly refresh's decisions: which differences between a fresh read and
 * the listing are written, and which are held. Pages are written the way real
 * off-season sites word these things.
 */
import { describe, it, expect } from 'bun:test'
import { isRefreshable, planEventRefresh, sameRefreshValue } from '../src/listings/event-refresh-plan.js'

const TODAY = '2026-09-30'

const listing = {
  id: 'a',
  name: 'Beach Blitz',
  venueName: 'Capistrano Valley High School',
  address: null,
  city: 'Mission Viejo',
  region: 'CA',
  country: 'US',
  hostTeamNumber: 4414,
  hostTeamNumbers: [4414],
  startDate: '2026-10-30',
  endDate: '2026-11-01',
  seasonYear: 2026,
  registrationStatus: 'open',
  registrationUrl: 'https://forms.gle/abc123',
  website: 'https://beachblitz.org',
  teamListUrl: null,
  costUsd: 250,
  notes: null,
  humanEditedFields: null as string[] | null,
}

const page = (text: string) => [{ source: 'https://beachblitz.org/register', text }]

describe('planEventRefresh', () => {
  it('applies registration open -> closed when the quote is on the page', () => {
    const plan = planEventRefresh({
      current: listing,
      fields: { registrationStatus: 'closed' },
      evidence: { registrationStatus: { quote: 'Team registration for Beach Blitz 2026 is now closed.' } },
      sources: page('Register\nTeam registration for Beach Blitz 2026 is now closed. Thank you to all 40 teams!'),
      today: TODAY,
    })
    expect(plan.patch).toEqual({ registrationStatus: 'closed' })
    expect(plan.applied).toEqual([{ key: 'registrationStatus', label: 'Registration', from: 'open', to: 'closed' }])
    expect(plan.held).toEqual([])
  })

  it('applies a changed venue, re-geocodes, and leaves the roster alone', () => {
    const plan = planEventRefresh({
      current: listing,
      fields: { venueName: 'Mission Viejo High School' },
      evidence: { venueName: { quote: 'Location: Mission Viejo High School, Mission Viejo, California' } },
      sources: page('Dates: Friday, October 30 - Sunday, November 1, 2026\nLocation: Mission Viejo High School, Mission Viejo, California'),
      today: TODAY,
    })
    expect(plan.patch).toEqual({ venueName: 'Mission Viejo High School' })
    expect(plan.needsGeocode).toBe(true)
    expect(plan.needsRosterRefresh).toBe(false)
  })

  it('never touches a field a person claimed', () => {
    const plan = planEventRefresh({
      current: { ...listing, humanEditedFields: ['venueName'] },
      fields: { venueName: 'Mission Viejo High School' },
      evidence: { venueName: { quote: 'Location: Mission Viejo High School, Mission Viejo, California' } },
      sources: page('Location: Mission Viejo High School, Mission Viejo, California'),
      today: TODAY,
    })
    expect(plan.patch).toEqual({})
    expect(plan.held[0]).toMatchObject({ key: 'venueName', reason: 'human_claimed' })
  })

  it('applies a start date moved 90 days when the quote proves it, and refreshes the roster', () => {
    const plan = planEventRefresh({
      current: listing,
      fields: { startDate: '2027-01-28', endDate: '2027-01-30' },
      evidence: {
        startDate: { quote: 'Beach Blitz has moved to January 28 - 30, 2027' },
        endDate: { quote: 'Beach Blitz has moved to January 28 - 30, 2027' },
      },
      sources: page('Update: Beach Blitz has moved to January 28 - 30, 2027 because of gym construction.'),
      today: TODAY,
    })
    expect(plan.patch).toEqual({ startDate: '2027-01-28', endDate: '2027-01-30', seasonYear: 2027 })
    expect(plan.needsRosterRefresh).toBe(true)
  })

  it('holds a date that is already past, which is last year read by mistake', () => {
    const plan = planEventRefresh({
      current: listing,
      fields: { startDate: '2025-11-01' },
      evidence: { startDate: { quote: 'Beach Blitz 2025: November 1, 2025' } },
      sources: page('Past events\nBeach Blitz 2025: November 1, 2025'),
      today: TODAY,
    })
    expect(plan.patch).toEqual({})
    expect(plan.held[0]).toMatchObject({ key: 'startDate', reason: 'past_date' })
  })

  it('holds a cleared value', () => {
    const plan = planEventRefresh({
      current: listing,
      fields: { registrationUrl: null, registrationStatus: 'unknown' },
      evidence: {},
      sources: page('Beach Blitz returns this fall.'),
      today: TODAY,
    })
    expect(plan.patch).toEqual({})
    expect(plan.held.map((h) => [h.key, h.reason])).toEqual([
      ['registrationStatus', 'clears'],
      ['registrationUrl', 'clears'],
    ])
  })

  it('holds a value whose quote is not in the page text', () => {
    const plan = planEventRefresh({
      current: listing,
      fields: { costUsd: 300 },
      evidence: { costUsd: { quote: 'The registration fee is $300 per team' } },
      sources: page('Registration fee: $250 per team, payable by check or card.'),
      today: TODAY,
    })
    expect(plan.patch).toEqual({})
    expect(plan.held[0]).toMatchObject({ key: 'costUsd', reason: 'unproven', from: '250', to: '300' })
  })

  it('applies a sign-up link that moved host when the page links it', () => {
    const plan = planEventRefresh({
      current: listing,
      fields: { registrationUrl: 'https://www.zeffy.com/en-US/ticketing/beach-blitz-2026' },
      evidence: { registrationUrl: { quote: 'Register' } },
      sources: page('Register your team\nhttps://www.zeffy.com/en-US/ticketing/beach-blitz-2026'),
      today: TODAY,
    })
    expect(plan.patch).toEqual({ registrationUrl: 'https://www.zeffy.com/en-US/ticketing/beach-blitz-2026' })
  })

  it('holds a reworded venue whose old name is still on the page', () => {
    const plan = planEventRefresh({
      current: listing,
      fields: { venueName: 'Capistrano Valley HS' },
      evidence: { venueName: { quote: 'held at Capistrano Valley HS' } },
      sources: page('Beach Blitz is held at Capistrano Valley HS (Capistrano Valley High School, 26301 Via Escolar).'),
      today: TODAY,
    })
    expect(plan.patch).toEqual({})
    expect(plan.held[0]).toMatchObject({ key: 'venueName', reason: 'reworded' })
  })

  it('leaves cancellation to the status watch', () => {
    const plan = planEventRefresh({
      current: { ...listing, eventStatus: 'confirmed' },
      fields: { eventStatus: 'cancelled' },
      evidence: { eventStatus: { quote: "This year's Beach Blitz is cancelled." } },
      sources: page("This year's Beach Blitz is cancelled."),
      today: TODAY,
    })
    expect(plan.patch).toEqual({})
    expect(plan.held[0]).toMatchObject({ key: 'eventStatus', reason: 'status_not_refreshable' })
  })
})

describe('sameRefreshValue', () => {
  it('reads a respelled link as the same link', () => {
    expect(sameRefreshValue('website', 'https://beachblitz.org', 'http://www.beachblitz.org/')).toBe(true)
  })
})

describe('isRefreshable', () => {
  const base = { status: 'published', eventStatus: 'confirmed', startDate: '2026-09-26', endDate: '2026-09-30' }
  it('keeps an event whose last day is today', () => {
    expect(isRefreshable(base, TODAY)).toBe(true)
  })
  it('drops an event that is over, and one that is cancelled', () => {
    expect(isRefreshable({ ...base, endDate: '2026-09-29' }, TODAY)).toBe(false)
    expect(isRefreshable({ ...base, eventStatus: 'cancelled', endDate: '2026-10-30' }, TODAY)).toBe(false)
  })
})

import { countryCode, streetKey, priceQuoteIsSecondRobot, sameRefreshValue } from '../src/listings/event-refresh-plan.js'
describe('dry-run findings 2026-10-01', () => {
  it('treats spellings of one country and one street as the same', () => {
    expect(countryCode('United States')).toBe(countryCode('US'))
    expect(sameRefreshValue('address', '23499 Southeast Tahoma Way', '23499 SE Tahoma Way, Maple Valley, Washington, 98038')).toBe(true)
    expect(streetKey('8080 New Cut Road')).toBe(streetKey('8080 New Cut Rd.'))
  })
  it('knows a second-robot price quote', () => {
    expect(priceQuoteIsSecondRobot('Veteran vs Veteran "B team" registration ($225–$350)')).toBe(true)
    expect(priceQuoteIsSecondRobot('Registration is $300 per team')).toBe(false)
  })
})
