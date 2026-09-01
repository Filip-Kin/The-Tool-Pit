import { describe, it, expect } from 'vitest'
import {
  offseasonSeasonYear,
  currentOffseasonSeason,
  isArchivedSeason,
  SEASON_RENEWAL_MONTH,
  SEASON_RENEWAL_DAY,
  SEASON_RENEWAL_WINDOW_DAYS,
} from '@the-tool-pit/db'
import {
  seasonRenewalDedupeKey,
  renewalRecipients,
  buildRenewalPayload,
  type OwnerRow,
  type RenewableListing,
} from '../src/listings/season-renewal.js'
import {
  SEASON_RENEWAL_EMAIL_KIND,
  isSeasonRenewalPayload,
  renderSeasonRenewalEmail,
} from '../src/notifications/season-renewal-email.js'

/**
 * The offseason season lifecycle.
 *
 * Three promises are worth a test here, and they are the three ways this
 * feature fails in public:
 *
 *   1. THE SEASON IS THE CALENDAR YEAR. Get this wrong by borrowing the FTC
 *      competition-season convention used elsewhere in this repo and every
 *      listing is filed a year out.
 *   2. THE ASK GOES ONCE. The job runs seven mornings in a row on purpose, so
 *      the dedupe key is the only thing between an organiser and seven
 *      identical emails.
 *   3. NOBODY IS EMAILED WHO SHOULD NOT BE. A seeded listing nobody claimed
 *      has no recipient at all, and that has to be silence, not a guess.
 */

// #region the season rule

describe('the offseason season is the calendar year', () => {
  it('reads the season off the start date', () => {
    expect(offseasonSeasonYear('2026-10-31')).toBe(2026)
    expect(offseasonSeasonYear('2027-06-27')).toBe(2027)
  })

  it('files a 1 January event in that calendar year, not the one before', () => {
    // Parsing through new Date() would give midnight UTC and roll this back to
    // 2026 for anyone west of Greenwich. The year is read off the string.
    expect(offseasonSeasonYear('2027-01-01')).toBe(2027)
  })

  it('does NOT use the FTC competition-season convention', () => {
    // Elsewhere in this codebase the 2025-26 FTC season is stored as 2026. An
    // offseason event in September 2026 is 2026 and nothing else.
    expect(offseasonSeasonYear('2026-09-12')).toBe(2026)
  })

  it('has no season for a listing with no dates yet', () => {
    expect(offseasonSeasonYear(null)).toBeNull()
    expect(offseasonSeasonYear(undefined)).toBeNull()
    expect(offseasonSeasonYear('')).toBeNull()
    expect(offseasonSeasonYear('not a date')).toBeNull()
  })

  it('rolls over at midnight on 1 January and not before', () => {
    expect(currentOffseasonSeason(new Date(2026, 11, 31, 23, 59))).toBe(2026)
    expect(currentOffseasonSeason(new Date(2027, 0, 1, 0, 0))).toBe(2027)
  })
})

describe('isArchivedSeason', () => {
  it('archives the whole of last year in one step on 1 January', () => {
    expect(isArchivedSeason(2026, 2026)).toBe(false)
    expect(isArchivedSeason(2026, 2027)).toBe(true)
  })

  it('never archives a listing that has no season yet', () => {
    // A listing with no dates is one somebody is still putting together.
    // Hiding it because we could not read a year off it is the one failure
    // mode this feature must not have.
    expect(isArchivedSeason(null, 2027)).toBe(false)
    expect(isArchivedSeason(undefined, 2027)).toBe(false)
  })

  it('keeps a listing already dated into a future season visible', () => {
    expect(isArchivedSeason(2028, 2027)).toBe(false)
  })
})

describe('the renewal date', () => {
  it('is mid-April, as named constants rather than a literal in the cron string', () => {
    expect(SEASON_RENEWAL_MONTH).toBe(4)
    expect(SEASON_RENEWAL_DAY).toBe(15)
  })

  it('covers a week, so one missed morning does not skip a season', () => {
    expect(SEASON_RENEWAL_WINDOW_DAYS).toBeGreaterThan(1)
    // Still April on the last day of the window.
    expect(SEASON_RENEWAL_DAY + SEASON_RENEWAL_WINDOW_DAYS - 1).toBeLessThanOrEqual(30)
  })
})

// #endregion

// #region dedupe

describe('seasonRenewalDedupeKey', () => {
  it('is the same key for the same ask, so seven passes are one email', () => {
    // This is the whole reason the job can be scheduled for a week of
    // mornings. Every pass re-derives the identical key and the unique index
    // on notification_outbox.dedupe_key throws the repeats away.
    const first = seasonRenewalDedupeKey(2027, 'listing-1', 'user-1')
    const second = seasonRenewalDedupeKey(2027, 'listing-1', 'user-1')
    expect(first).toBe(second)
  })

  it('separates the two people who both manage one listing', () => {
    expect(seasonRenewalDedupeKey(2027, 'listing-1', 'user-1')).not.toBe(
      seasonRenewalDedupeKey(2027, 'listing-1', 'user-2'),
    )
  })

  it('separates two listings the same person manages', () => {
    expect(seasonRenewalDedupeKey(2027, 'listing-1', 'user-1')).not.toBe(
      seasonRenewalDedupeKey(2027, 'listing-2', 'user-1'),
    )
  })

  it('asks again next year, because next year is a different question', () => {
    expect(seasonRenewalDedupeKey(2027, 'listing-1', 'user-1')).not.toBe(
      seasonRenewalDedupeKey(2028, 'listing-1', 'user-1'),
    )
  })

  it('carries the kind and the season where an admin can read them', () => {
    expect(seasonRenewalDedupeKey(2027, 'listing-1', 'user-1')).toBe(
      'event_season_renewal:2027:listing-1:user-1',
    )
    expect(seasonRenewalDedupeKey(2027, 'listing-1', 'user-1').startsWith(SEASON_RENEWAL_EMAIL_KIND)).toBe(true)
  })

  it('cannot collide with a moderation outcome key for the same listing', () => {
    // Approval keys are `<kind>:<subjectId>:<userId>`. A renewal key has the
    // season wedged in the middle, so the two shapes cannot meet.
    expect(seasonRenewalDedupeKey(2027, 'listing-1', 'user-1')).not.toBe(
      `event_published:listing-1:user-1`,
    )
  })
})

// #endregion

// #region who gets asked

const LISTING = { id: 'listing-1', submittedByUserId: null as string | null }

describe('renewalRecipients', () => {
  it('asks the people who hold a write role on the listing', () => {
    const owners: OwnerRow[] = [
      { entityId: 'listing-1', userId: 'owner-1', role: 'owner' },
      { entityId: 'listing-1', userId: 'editor-1', role: 'editor' },
    ]
    expect(renewalRecipients(LISTING, owners).sort()).toEqual(['editor-1', 'owner-1'])
  })

  it('does not ask a viewer, who could not act on the answer', () => {
    const owners: OwnerRow[] = [{ entityId: 'listing-1', userId: 'viewer-1', role: 'viewer' }]
    expect(renewalRecipients(LISTING, owners)).toEqual([])
  })

  it('ignores roles held on a different listing', () => {
    const owners: OwnerRow[] = [{ entityId: 'listing-2', userId: 'owner-2', role: 'owner' }]
    expect(renewalRecipients(LISTING, owners)).toEqual([])
  })

  it('falls back to the signed-in submitter when nobody has claimed it', () => {
    const listing = { id: 'listing-1', submittedByUserId: 'submitter-1' }
    expect(renewalRecipients(listing, [])).toEqual(['submitter-1'])
  })

  it('prefers the claimed owners over the submitter rather than mailing both', () => {
    const listing = { id: 'listing-1', submittedByUserId: 'submitter-1' }
    const owners: OwnerRow[] = [{ entityId: 'listing-1', userId: 'owner-1', role: 'owner' }]
    expect(renewalRecipients(listing, owners)).toEqual(['owner-1'])
  })

  it('counts one person once when they hold two roles', () => {
    const owners: OwnerRow[] = [
      { entityId: 'listing-1', userId: 'owner-1', role: 'owner' },
      { entityId: 'listing-1', userId: 'owner-1', role: 'editor' },
    ]
    expect(renewalRecipients(LISTING, owners)).toEqual(['owner-1'])
  })

  it('asks nobody about a seeded listing, which is the normal case today', () => {
    // The 16 FIM listings were seeded from Filip's spreadsheet: no signed-in
    // submitter, no claim. There is nobody to write to and that is not an
    // error, it is silence.
    expect(renewalRecipients(LISTING, [])).toEqual([])
  })
})

// #endregion

// #region the email

const BOT_BASH: RenewableListing = {
  id: 'listing-1',
  name: 'Bot Bash',
  seasonYear: 2026,
  startDate: '2026-10-31',
  endDate: null,
  venueName: 'Herbert Henry Dow High School',
  city: 'Midland',
  region: 'MI',
  country: 'USA',
  capacity: 32,
  costUsd: 300,
}

describe('buildRenewalPayload', () => {
  it('asks about the new season and names the season it is asking from', () => {
    const p = buildRenewalPayload(BOT_BASH, 2027)
    expect(p.seasonYear).toBe(2027)
    expect(p.previousSeasonYear).toBe(2026)
    expect(p.title).toBe('Bot Bash')
  })

  it('links to the prefilled form for the listing being renewed', () => {
    const p = buildRenewalPayload(BOT_BASH, 2027)
    expect(p.renewUrl).toContain('/events/submit?renew=listing-1')
    expect(p.previousUrl).toContain('/events/listing-1')
  })

  it('carries last years facts, labelled with the year they are from', () => {
    const p = buildRenewalPayload(BOT_BASH, 2027)
    const labels = (p.facts ?? []).map((f) => f.label)
    const values = (p.facts ?? []).map((f) => f.value)
    expect(labels).toContain('2026 dates')
    expect(values).toContain('31 October 2026')
    expect(values).toContain('Herbert Henry Dow High School, Midland, MI, USA')
    expect(values).toContain('32 teams')
    expect(values).toContain('$300')
  })

  it('says Free rather than $0', () => {
    const p = buildRenewalPayload({ ...BOT_BASH, costUsd: 0 }, 2027)
    expect((p.facts ?? []).map((f) => f.value)).toContain('Free')
  })

  it('leaves out a fact it does not have instead of printing a blank row', () => {
    const bare: RenewableListing = {
      id: 'listing-2',
      name: 'Mystery Offseason',
      seasonYear: 2026,
      startDate: null,
      endDate: null,
      venueName: null,
      city: null,
      region: null,
      country: null,
      capacity: null,
      costUsd: null,
    }
    const p = buildRenewalPayload(bare, 2027)
    expect(p.facts).toEqual([])
    // The email still identifies it: the render adds the link back to last
    // year's listing, so a body with no facts at all is not possible.
    const body = renderSeasonRenewalEmail(p, 'https://frc.tools/me/notifications')
    expect(body.text).toContain('2026 listing')
    expect(body.text).toContain('/events/listing-2')
  })

  it('spans a two-day event', () => {
    const p = buildRenewalPayload({ ...BOT_BASH, endDate: '2026-11-01' }, 2027)
    expect((p.facts ?? []).map((f) => f.value)).toContain('31 October 2026 to 1 November 2026')
  })
})

describe('renderSeasonRenewalEmail', () => {
  const PREFS = 'https://frc.tools/me/notifications'
  const body = renderSeasonRenewalEmail(buildRenewalPayload(BOT_BASH, 2027), PREFS)

  it('asks the question in the subject, with the event and the year in it', () => {
    expect(body.subject).toBe('Are you running Bot Bash in 2027?')
  })

  it('puts the button on the prefilled form', () => {
    expect(body.html).toContain('/events/submit?renew=listing-1')
    expect(body.html).toContain('Start the 2027 listing')
    expect(body.text).toContain('/events/submit?renew=listing-1')
  })

  it('says what happens if they do nothing, so nobody has to reply to opt out', () => {
    expect(body.text).toContain('ignore this')
    expect(body.text).toContain('only email we send about it')
  })

  it('says why they got it and how to stop getting them', () => {
    expect(body.text).toContain('you manage the 2026 listing')
    expect(body.text).toContain(PREFS)
  })

  it('uses no em dashes', () => {
    expect(body.subject).not.toContain('—')
    expect(body.text).not.toContain('—')
    expect(body.html).not.toContain('—')
  })
})

describe('isSeasonRenewalPayload', () => {
  it('accepts a payload this deploy wrote', () => {
    expect(isSeasonRenewalPayload(buildRenewalPayload(BOT_BASH, 2027))).toBe(true)
  })

  it('refuses anything it cannot render, so the drain parks it with a reason', () => {
    expect(isSeasonRenewalPayload(null)).toBe(false)
    expect(isSeasonRenewalPayload('Bot Bash')).toBe(false)
    expect(isSeasonRenewalPayload({ title: '', seasonYear: 2027, previousSeasonYear: 2026, renewUrl: 'x' })).toBe(false)
    expect(isSeasonRenewalPayload({ title: 'Bot Bash', seasonYear: 2027, previousSeasonYear: 2026 })).toBe(false)
    expect(isSeasonRenewalPayload({ title: 'Bot Bash', seasonYear: '2027', previousSeasonYear: 2026, renewUrl: 'x' })).toBe(false)
  })
})

// #endregion
