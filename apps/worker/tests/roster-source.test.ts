import { describe, it, expect } from 'vitest'
import { chooseRosterSource, decideScrapedRoster, findTbaMatch } from '../src/listings/roster-refresh.js'
import type { TbaEventUpsert } from '../src/connectors/tba-events.js'
import type { RosterTeam } from '@the-tool-pit/db'

const t = (...nums: number[]): RosterTeam[] => nums.map((number) => ({ number, robot: null }))

// The one rule these tests exist to pin: an event's OWN site is the roster
// source until it starts, and TBA is authoritative once it has. A regression
// here silently swaps a fresh pre-event list for a TBA event that has not been
// coded yet, or keeps scraping a page after TBA holds the real turnout.
const TODAY = '2026-07-15'

describe('chooseRosterSource', () => {
  it('prefers the website before the event starts even when a tbaKey exists', () => {
    expect(
      chooseRosterSource({ tbaKey: '2026miket', teamListUrl: 'https://x/teams', startDate: '2026-07-20' }, TODAY),
    ).toBe('site')
  })

  it('switches to TBA once the event has started', () => {
    expect(
      chooseRosterSource({ tbaKey: '2026miket', teamListUrl: 'https://x/teams', startDate: '2026-07-10' }, TODAY),
    ).toBe('tba')
  })

  it('treats the start day itself as started (TBA authoritative)', () => {
    expect(
      chooseRosterSource({ tbaKey: '2026miket', teamListUrl: 'https://x/teams', startDate: TODAY }, TODAY),
    ).toBe('tba')
  })

  it('missing startDate means not started, so the website wins when it exists', () => {
    expect(
      chooseRosterSource({ tbaKey: '2026miket', teamListUrl: 'https://x/teams', startDate: null }, TODAY),
    ).toBe('site')
  })

  it('uses TBA when that is the only source', () => {
    expect(chooseRosterSource({ tbaKey: '2026miket', teamListUrl: null, startDate: '2026-07-20' }, TODAY)).toBe('tba')
  })

  it('uses the website when that is the only source, even after the event', () => {
    expect(chooseRosterSource({ tbaKey: null, teamListUrl: 'https://x/teams', startDate: '2026-01-01' }, TODAY)).toBe(
      'site',
    )
  })

  it('returns null when there is nothing to read', () => {
    expect(chooseRosterSource({ tbaKey: null, teamListUrl: null, startDate: '2026-07-20' }, TODAY)).toBeNull()
  })
})

describe('findTbaMatch', () => {
  const events: TbaEventUpsert[] = [
    {
      tbaKey: '2026miket',
      eventCode: 'miket',
      year: 2026,
      name: 'Kettering Kickoff',
      shortName: 'Kettering',
      startDate: '2026-09-12',
      endDate: '2026-09-13',
      week: null,
      eventType: 99,
      eventTypeString: 'Offseason',
      city: 'Flint',
      stateProv: 'MI',
      country: 'USA',
      venue: 'Kettering University',
      address: '1700 University Ave',
      website: null,
    },
  ]

  it('matches on normalised name plus exact start date', () => {
    const m = findTbaMatch({ name: 'Kettering Kickoff!', startDate: '2026-09-12', city: null, region: null }, events)
    expect(m?.tbaKey).toBe('2026miket')
    expect(m?.reason).toBe('name + start date')
  })

  it('matches on name plus city and region when dates are absent', () => {
    const m = findTbaMatch({ name: 'kettering  kickoff', startDate: null, city: 'Flint', region: 'mi' }, events)
    expect(m?.tbaKey).toBe('2026miket')
    expect(m?.reason).toBe('name + city/region')
  })

  it('refuses a name match with no corroborating signal', () => {
    expect(
      findTbaMatch({ name: 'Kettering Kickoff', startDate: '2026-08-01', city: 'Detroit', region: 'MI' }, events),
    ).toBeNull()
  })

  it('refuses a different event outright', () => {
    expect(
      findTbaMatch({ name: 'Bunnybots', startDate: '2026-09-12', city: 'Flint', region: 'MI' }, events),
    ).toBeNull()
  })
})

// The rule CHANGE 1 added: a site-scraped roster auto-approves and writes the
// public count when it reads cleanly, and is HELD (never auto-written) when the
// suspect guard fires. decideScrapedRoster is the single source of that split,
// so the loop's stored status and count-write cannot drift from it.
describe('decideScrapedRoster (auto-approve vs held)', () => {
  it('clean unchanged roster: approved, writes the count', () => {
    const d = decideScrapedRoster(t(503, 247, 8728, 226), t(503, 247, 8728, 226))
    expect(d.status).toBe('approved')
    expect(d.writeCount).toBe(true)
  })

  it('clean growth (a superset): approved, writes the count', () => {
    const d = decideScrapedRoster(t(503, 247, 8728), t(503, 247, 8728, 226, 1114))
    expect(d.status).toBe('approved')
    expect(d.writeCount).toBe(true)
  })

  it('first roster on a brand-new listing (no previous): approved', () => {
    const d = decideScrapedRoster([], t(254, 1678, 118, 148, 33, 217, 1114, 610))
    expect(d.status).toBe('approved')
    expect(d.writeCount).toBe(true)
  })

  it('minor churn keeping more than half: approved', () => {
    const d = decideScrapedRoster(t(11, 22, 33, 44), t(11, 22, 33, 99))
    expect(d.status).toBe('approved')
    expect(d.writeCount).toBe(true)
  })

  it('leaked slot indices: held, no count write', () => {
    const d = decideScrapedRoster(t(503, 247, 8728, 226), t(1, 2, 3, 4, 5, 6, 7, 8))
    expect(d.status).toBe('rejected')
    expect(d.writeCount).toBe(false)
    expect(d.reason).toBeTruthy()
  })

  it('roster emptied while the last one was not: held', () => {
    const d = decideScrapedRoster(t(503, 247, 8728, 226), [])
    expect(d.status).toBe('rejected')
    expect(d.writeCount).toBe(false)
  })

  it('more than half the teams vanished without being a superset: held', () => {
    const d = decideScrapedRoster(t(11, 22, 33, 44, 55, 66), t(11, 77))
    expect(d.status).toBe('rejected')
    expect(d.writeCount).toBe(false)
  })
})
