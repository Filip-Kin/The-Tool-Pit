/**
 * The field-by-field diff behind the merge dialog.
 *
 * Wolverine is the real case that motivated this: the listing has capacity 40
 * and a blank cost note, and its own candidate read capacity 32 off the
 * current thread. Silently keeping 40 throws away a correction nobody would
 * see; silently taking 32 overwrites a number an organiser may have set on
 * purpose. Neither default is safe, which is why this returns both values and
 * a "do they differ" flag instead of picking one.
 */
import { describe, it, expect } from 'bun:test'
import { diffEventFields } from '@/lib/admin/event-merge'

const listing = {
  name: 'FAMNM Wolverine Robotics Competition',
  venueName: 'Skyline High School',
  address: '2552 N Maple Rd, Ann Arbor, MI 48103',
  city: 'Ann Arbor',
  region: 'MI',
  country: 'USA',
  startDate: '2026-08-01',
  endDate: null,
  days: 1,
  capacity: 40,
  costUsd: 250,
  costNote: null,
  registrationStatus: 'not_open',
  volunteerStatus: 'not_open',
  website: 'https://famnm.club/offseason/',
  registrationUrl: null,
  volunteerUrl: null,
  teamListUrl: null,
  contactEmail: 'famnm.offseason@umich.edu',
  notes: null,
  tbaKey: '2026miwrc',
  latitude: 42.3052254,
  longitude: -83.77713,
}

const extracted = {
  name: 'Wolverine Robotics Competition',
  venueName: 'Skyline High School',
  address: '2552 N Maple Rd, Ann Arbor, MI 48103',
  city: 'Ann Arbor',
  region: 'MI',
  country: 'US',
  program: 'frc',
  website: 'https://famnm.club/offseason',
  capacity: 32,
  latitude: 42.3056825,
  longitude: -83.7801965,
  startDate: '2026-08-01',
  contactEmail: 'famnm.offseason@umich.edu',
  chiefDelphiUrl: 'https://www.chiefdelphi.com/t/x/518110',
  registrationStatus: 'closed',
  notes: 'The event featured qualifications, playoffs, and judged awards all in one day.',
}

describe('diffEventFields', () => {
  const rows = diffEventFields(listing, extracted as never)
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))

  it('flags a real disagreement', () => {
    expect(byKey.capacity.differs).toBe(true)
    expect(byKey.capacity.existing).toBe(40)
    expect(byKey.capacity.detected).toBe(32)

    expect(byKey.registrationStatus.differs).toBe(true)
    expect(byKey.registrationStatus.existing).toBe('not_open')
    expect(byKey.registrationStatus.detected).toBe('closed')
  })

  it('offers a fill-in for a blank field as a disagreement', () => {
    expect(byKey.notes.existing).toBeNull()
    expect(byKey.notes.detected).toContain('qualifications')
    expect(byKey.notes.differs).toBe(true)
  })

  it('does not flag USA vs US as a disagreement', () => {
    expect(byKey.country.differs).toBe(false)
  })

  it('does not flag a trailing slash as a disagreement', () => {
    expect(byKey.website.differs).toBe(false)
  })

  it('does not flag a name that only differs by an org prefix as agreeing, since it genuinely differs', () => {
    // "FAMNM Wolverine Robotics Competition" vs "Wolverine Robotics
    // Competition" is a real difference a reviewer should see, not noise to
    // fold away like USA/US.
    expect(byKey.name.differs).toBe(true)
  })

  it('omits a field the candidate has nothing to say about', () => {
    // tbaKey exists on both, day count and volunteerStatus were never read.
    expect(byKey.days).toBeUndefined()
    expect(byKey.volunteerStatus).toBeUndefined()
    expect(byKey.tbaKey).toBeUndefined() // equal, both '2026miwrc' -> no decision needed
  })

  it('sorts disagreements before agreements', () => {
    const firstAgreement = rows.findIndex((r) => !r.differs)
    const lastDisagreement = rows.map((r) => r.differs).lastIndexOf(true)
    expect(lastDisagreement).toBeLessThan(firstAgreement === -1 ? Infinity : firstAgreement)
  })
})
