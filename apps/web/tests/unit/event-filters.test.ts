/**
 * The off-season map's filter menu: distance, cost, team number and dates.
 *
 * Two things are pinned here. The first is the missing-data rule, which is the
 * only part of this that is a judgement call rather than arithmetic: a filter
 * naming a limit keeps only the events it can check against that limit, so an
 * event with no listed price is not kept by "up to $300". The second is the
 * date range being an OVERLAP and not a containment, so a two-day event that
 * starts the day before the range is still in it.
 */
import { describe, it, expect } from 'bun:test'
import {
  NO_FILTERS,
  activeFilterCount,
  matchesEventFilters,
  type EventFilters,
} from '@/lib/events/event-filters'
import type { PublicEvent } from '@/lib/events/event-display'

function ev(over: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id: 'e1',
    slug: 'e1',
    program: 'frc',
    name: 'Test Event',
    hostTeamNumber: null,
    latitude: 43,
    longitude: -84,
    venueName: null,
    address: null,
    city: null,
    region: null,
    country: null,
    seasonYear: 2026,
    previousListingId: null,
    startDate: '2026-09-12',
    endDate: '2026-09-13',
    days: 2,
    parallelDivisions: false,
    capacity: 40,
    costUsd: 300,
    costNote: null,
    registrationStatus: 'open',
    registrationOpensAt: null,
    registrationClosesAt: null,
    volunteerStatus: 'unknown',
    eventStatus: 'confirmed',
    website: null,
    registrationUrl: null,
    volunteerUrl: null,
    chiefDelphiUrl: null,
    contactEmail: null,
    notes: null,
    tbaKey: null,
    registeredTeamCount: null,
    teamCountUpdatedAt: null,
    ...over,
  }
}

function withFilters(over: Partial<EventFilters>): EventFilters {
  return { ...NO_FILTERS, ...over }
}

const NO_CONTEXT = { km: null, rosterTeams: null }

describe('matchesEventFilters', () => {
  it('keeps an event inside the distance cap and drops one outside it', () => {
    const f = withFilters({ maxDistanceKm: 100 })
    expect(matchesEventFilters(ev(), f, { km: 80, rosterTeams: null })).toBe(true)
    expect(matchesEventFilters(ev(), f, { km: 240, rosterTeams: null })).toBe(false)
  })

  it('drops an event whose distance is unknown once a distance cap is set', () => {
    // No coordinates, or no location from the reader. Nobody has said it is
    // within 100 km, so "within 100 km" must not claim it is.
    expect(matchesEventFilters(ev(), withFilters({ maxDistanceKm: 100 }), NO_CONTEXT)).toBe(false)
  })

  it('drops an event with no listed price once a cost cap is set', () => {
    const f = withFilters({ maxCostUsd: 300 })
    expect(matchesEventFilters(ev({ costUsd: 300 }), f, NO_CONTEXT)).toBe(true)
    expect(matchesEventFilters(ev({ costUsd: 400 }), f, NO_CONTEXT)).toBe(false)
    expect(matchesEventFilters(ev({ costUsd: null }), f, NO_CONTEXT)).toBe(false)
  })

  it('matches a team number against the roster, and drops an event with no roster', () => {
    const f = withFilters({ teamNumber: 4145 })
    expect(matchesEventFilters(ev(), f, { km: null, rosterTeams: [217, 4145] })).toBe(true)
    expect(matchesEventFilters(ev(), f, { km: null, rosterTeams: [217, 5150] })).toBe(false)
    expect(matchesEventFilters(ev(), f, NO_CONTEXT)).toBe(false)
  })

  it('reads the date range as an overlap, not a containment', () => {
    const f = withFilters({ from: '2026-09-13', to: '2026-09-30' })
    // Runs 12-13 September: it starts before the range and still overlaps it.
    expect(matchesEventFilters(ev(), f, NO_CONTEXT)).toBe(true)
    expect(matchesEventFilters(ev({ startDate: '2026-10-01', endDate: '2026-10-02' }), f, NO_CONTEXT)).toBe(false)
    expect(matchesEventFilters(ev({ startDate: null, endDate: null }), f, NO_CONTEXT)).toBe(false)
  })
})

describe('activeFilterCount', () => {
  it('counts a date range once however many ends are set', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
    expect(activeFilterCount(withFilters({ from: '2026-09-01' }))).toBe(1)
    expect(activeFilterCount(withFilters({ from: '2026-09-01', to: '2026-09-30' }))).toBe(1)
    expect(activeFilterCount(withFilters({ from: '2026-09-01', to: '2026-09-30', maxCostUsd: 0 }))).toBe(2)
  })
})
