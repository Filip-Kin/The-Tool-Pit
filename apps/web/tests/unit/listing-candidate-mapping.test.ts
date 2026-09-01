import { describe, it, expect } from 'vitest'
import {
  eventListingFromCandidate,
  practiceFieldFromCandidate,
} from '@/lib/admin/listing-candidate-mapping'

/**
 * What a reviewer's Accept actually writes.
 *
 * This is the join between a crawler and the public directory, and the two
 * ways it can be wrong both cost somebody a drive: a value invented from a
 * half-parse, or a scraped row that skips the review a submitted row gets. So
 * every case here is either "a dubious value is dropped" or "the row lands
 * pending, unpublished and unplaced".
 */

describe('eventListingFromCandidate', () => {
  const base = { sourceUrl: 'https://www.thebluealliance.com/event/2026mikec', tbaKey: null }

  it('lands pending, scraped, and with no pin', () => {
    const row = eventListingFromCandidate({ ...base, extracted: {} }, 'Kettering Kickoff')
    expect(row.status).toBe('pending')
    expect(row.source).toBe('scrape')
    expect(row.name).toBe('Kettering Kickoff')
    // No coordinates: approveEvent() refuses to publish without them, which is
    // the half of the gate a crawler must not be able to satisfy.
    expect(row.latitude).toBeUndefined()
    expect(row.longitude).toBeUndefined()
    expect(row.publishedAt).toBeUndefined()
  })

  it('copies the fields a connector read deterministically', () => {
    const row = eventListingFromCandidate(
      {
        ...base,
        extracted: {
          program: 'ftc',
          hostTeamNumber: 3538,
          venueName: 'Kettering University',
          city: 'Flint',
          region: 'MI',
          country: 'USA',
          startDate: '2026-07-11',
          endDate: '2026-07-12',
          days: 2,
          website: 'https://example.org/kickoff',
        },
      },
      'Kettering Kickoff',
    )
    expect(row).toMatchObject({
      program: 'ftc',
      hostTeamNumber: 3538,
      venueName: 'Kettering University',
      city: 'Flint',
      region: 'MI',
      startDate: '2026-07-11',
      endDate: '2026-07-12',
      days: 2,
      website: 'https://example.org/kickoff',
    })
  })

  it('drops a date it cannot read rather than guessing at one', () => {
    const row = eventListingFromCandidate(
      { ...base, extracted: { startDate: 'July 11-12, 2026', endDate: '2026-07-12' } },
      'Kettering Kickoff',
    )
    expect(row.startDate).toBeNull()
    expect(row.endDate).toBe('2026-07-12')
  })

  it('drops a day count that is not one or two, and a link that is not a link', () => {
    const row = eventListingFromCandidate(
      { ...base, extracted: { days: 7, website: 'ask on the forum', registrationUrl: 'https://ok.example' } },
      'Kettering Kickoff',
    )
    expect(row.days).toBeNull()
    expect(row.website).toBeNull()
    expect(row.registrationUrl).toBe('https://ok.example')
  })

  it('falls back to an unknown program rather than inventing one', () => {
    const row = eventListingFromCandidate({ ...base, extracted: { program: 'vex' } }, 'Some Event')
    expect(row.program).toBe('frc')
  })

  it('keeps a forum thread as the listing pointer when the connector read no link', () => {
    const row = eventListingFromCandidate(
      { sourceUrl: 'https://www.chiefdelphi.com/t/summer-event/12345', tbaKey: null, extracted: {} },
      'Summer Event',
    )
    expect(row.chiefDelphiUrl).toBe('https://www.chiefdelphi.com/t/summer-event/12345')
  })

  it('takes the TBA key off the candidate column when the extract has none', () => {
    const row = eventListingFromCandidate({ ...base, tbaKey: '2026MIKEC', extracted: {} }, 'Kettering Kickoff')
    expect(row.tbaKey).toBe('2026mikec')
  })
})

describe('practiceFieldFromCandidate', () => {
  const base = { teamNumber: null }

  it('lands pending, scraped, and with no field spec', () => {
    const row = practiceFieldFromCandidate({ ...base, extracted: {} }, 'Team 3538 field')
    expect(row.status).toBe('pending')
    expect(row.source).toBe('scrape')
    // Coverage, perimeter, elements and FMS are left to their column defaults
    // on purpose: a thread saying "full field" may be describing the field the
    // poster wants, not the one on offer.
    expect(row.coverage).toBeUndefined()
    expect(row.perimeter).toBeUndefined()
    expect(row.elements).toBeUndefined()
    expect(row.hasFms).toBeUndefined()
    expect(row.latitude).toBeUndefined()
  })

  it('takes the team number off the candidate column when the extract has none', () => {
    const row = practiceFieldFromCandidate({ teamNumber: 3538, extracted: {} }, 'A field')
    expect(row.teamNumber).toBe(3538)
  })

  it('drops a contact link that is not a link', () => {
    const row = practiceFieldFromCandidate(
      { ...base, extracted: { contactUrl: 'DM me on the forum', website: 'https://team3538.example' } },
      'A field',
    )
    expect(row.contactUrl).toBeNull()
    expect(row.website).toBe('https://team3538.example')
  })
})
