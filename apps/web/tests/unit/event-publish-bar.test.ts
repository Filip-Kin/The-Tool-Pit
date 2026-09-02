/**
 * The bar an off-season event clears before it reaches /events.
 *
 * Written the day the TBA and Chief Delphi connectors were about to fire for
 * the first time. Every event on the site until now was hand-entered from a
 * spreadsheet and complete. A scraped candidate is not: TBA fills dates, venue,
 * address and location and cannot fill cost, capacity, registration state or a
 * contact.
 */
import { describe, it, expect } from 'bun:test'
import { eventPublishBlockers, type EventPublishFacts } from '@/lib/events/publish-bar'

/** Shaped on a real published row: Kettering Kickoff, 2026-09-12. */
const COMPLETE: EventPublishFacts = {
  latitude: 43.0,
  longitude: -83.7,
  startDate: '2026-09-12',
  venueName: 'Kettering University',
  address: '1700 University Ave, Flint, MI 48504',
  program: 'frc',
  registrationStatus: 'open',
}

describe('event publish bar', () => {
  it('passes a complete listing', () => {
    expect(eventPublishBlockers(COMPLETE)).toEqual([])
  })

  it.each([
    ['latitude', { latitude: null }, 'pin'],
    ['longitude', { longitude: null }, 'pin'],
    ['startDate', { startDate: null }, 'start date'],
    ['venueName', { venueName: null }, 'venue'],
    ['address', { address: null }, 'street address'],
    ['program', { program: null }, 'program'],
    ['registrationStatus', { registrationStatus: null }, 'registration status'],
  ])('blocks a listing with no %s', (_field, patch, expected) => {
    const blockers = eventPublishBlockers({ ...COMPLETE, ...(patch as Partial<EventPublishFacts>) })
    expect(blockers).toHaveLength(1)
    expect(blockers[0]).toContain(expected)
  })

  it('treats an empty string as missing', () => {
    // The admin form posts '' for a field somebody cleared, not null, so a
    // check on null alone would let a blank venue through.
    expect(eventPublishBlockers({ ...COMPLETE, venueName: '   ' })).toHaveLength(1)
  })

  it('does not block on cost', () => {
    // Deliberate. One of the 16 events published today has neither a price nor
    // a cost note and is a real, correctly listed event. A gate that rejects
    // rows already on the site is one reviewers route around.
    expect(eventPublishBlockers(COMPLETE)).toEqual([])
  })

  it('names every missing thing at once', () => {
    const blockers = eventPublishBlockers({
      latitude: null,
      longitude: null,
      startDate: null,
      venueName: null,
      address: null,
      program: null,
      registrationStatus: null,
    })
    // Six, not seven: the two coordinates are one missing thing to a reviewer.
    expect(blockers).toHaveLength(6)
  })

  it('accepts a Date as well as an ISO string', () => {
    expect(eventPublishBlockers({ ...COMPLETE, startDate: new Date('2026-09-12') })).toEqual([])
  })
})
