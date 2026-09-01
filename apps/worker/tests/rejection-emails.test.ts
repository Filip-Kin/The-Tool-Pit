import { describe, it, expect } from 'vitest'
import {
  APPROVAL_EMAIL_KINDS,
  REJECTION_EMAIL_KINDS,
  isApprovalEmailKind,
  isRejectionEmailKind,
  renderApprovalEmail,
  type ApprovalEmailKind,
} from '@the-tool-pit/types'
import { notificationDedupeKey } from '@the-tool-pit/db'

/**
 * The emails that carry bad news.
 *
 * EVERY MODERATION ACTION ON THE SITE DOES DOUBLE DUTY. suppressField,
 * suppressEvent, suppressCandidate, suppressAlbumCandidate and
 * suppressGrantCandidate all write the same status, and what it MEANS depends
 * on what the row was a second earlier: a pending submission refused, or a live
 * listing taken down. That is why the approval-email work skipped rejections
 * rather than sending one email for both, and it is what these kinds split.
 *
 * The four ways this feature fails in an inbox:
 *   1. A takedown reads like a refusal, so somebody thinks we lost their field.
 *   2. The reason is missing, which is the thing people write back about.
 *   3. It does not name the thing, so it means nothing six weeks later.
 *   4. It reads like an approval that went slightly wrong.
 */

const PREFS = 'https://frc.tools/me/notifications'
const REASON = 'The address is a school that has since told us it is not available.'

/** Every rejection kind paired with the approval it must not be confused with. */
const REMOVED_VS_REJECTED: Array<[ApprovalEmailKind, ApprovalEmailKind]> = [
  ['field_rejected', 'field_removed'],
  ['event_rejected', 'event_removed'],
  ['tool_rejected', 'tool_removed'],
  ['album_rejected', 'album_removed'],
  ['grant_rejected', 'grant_removed'],
]

describe('rejection kinds', () => {
  it('are all renderable kinds, so the drain never parks one unsent', () => {
    for (const kind of REJECTION_EMAIL_KINDS) {
      expect(isApprovalEmailKind(kind)).toBe(true)
      expect(isRejectionEmailKind(kind)).toBe(true)
    }
  })

  it('do not include an approval', () => {
    expect(isRejectionEmailKind('field_published')).toBe(false)
    expect(isRejectionEmailKind('claim_approved')).toBe(false)
    expect(isRejectionEmailKind('')).toBe(false)
    expect(isRejectionEmailKind(null)).toBe(false)
  })

  it('cover every kind the site can queue when the answer was no', () => {
    // A rejection kind missing from this list is one the queueing side would
    // not know needs a reason.
    const nos = APPROVAL_EMAIL_KINDS.filter((k) => k.includes('reject') || k.includes('removed'))
    for (const kind of nos) expect(isRejectionEmailKind(kind)).toBe(true)
  })
})

describe('rejected vs removed', () => {
  it('never says the same thing twice', () => {
    for (const [rejected, removed] of REMOVED_VS_REJECTED) {
      const no = renderApprovalEmail({ kind: rejected, title: 'Kettering Field House', reviewerNote: REASON, preferencesUrl: PREFS })
      const down = renderApprovalEmail({ kind: removed, title: 'Kettering Field House', reviewerNote: REASON, preferencesUrl: PREFS })
      expect(no.subject).not.toEqual(down.subject)
      expect(no.text).not.toEqual(down.text)
    }
  })

  it('tells a submitter their live listing came down, not that it was refused', () => {
    // The failure this exists to prevent: "your field was not accepted" landing
    // on somebody whose field has been on the map since March.
    const down = renderApprovalEmail({
      kind: 'field_removed',
      title: 'Kettering Field House',
      reviewerNote: REASON,
      preferencesUrl: PREFS,
    })
    expect(down.subject).toContain('removed')
    expect(down.text).toContain('is not any more')
    expect(down.subject).not.toContain('did not list')
  })

  it('tells a submitter a pending thing was not taken, without implying it was live', () => {
    const no = renderApprovalEmail({
      kind: 'field_rejected',
      title: 'Kettering Field House',
      reviewerNote: REASON,
      preferencesUrl: PREFS,
    })
    expect(no.subject).toContain('did not list')
    expect(no.text).not.toContain('is not any more')
  })
})

describe('the reason', () => {
  it('is in the body of every rejection, in HTML and in plain text', () => {
    for (const kind of REJECTION_EMAIL_KINDS) {
      const body = renderApprovalEmail({ kind, title: 'Something', reviewerNote: REASON, preferencesUrl: PREFS })
      expect(body.text).toContain(REASON)
      expect(body.html).toContain('The address is a school')
    }
  })

  it('is labelled as the reason, not as a remark alongside one', () => {
    // On an approval the note is an aside. On a rejection it IS the decision,
    // so "Reviewer's note" would bury the only line that matters.
    const no = renderApprovalEmail({ kind: 'tool_rejected', title: 'A tool', reviewerNote: REASON, preferencesUrl: PREFS })
    expect(no.text).toContain(`Why: ${REASON}`)

    const yes = renderApprovalEmail({ kind: 'tool_published', title: 'A tool', reviewerNote: 'Nice one.', preferencesUrl: PREFS })
    expect(yes.text).toContain('Nice one.')
    expect(yes.text).not.toContain('Why: Nice one.')
  })

  it('is escaped, because an admin types it and it lands in HTML', () => {
    const body = renderApprovalEmail({
      kind: 'event_rejected',
      title: 'An event',
      reviewerNote: '<script>alert(1)</script>',
      preferencesUrl: PREFS,
    })
    expect(body.html).not.toContain('<script>')
    expect(body.html).toContain('&lt;script&gt;')
  })
})

describe('naming the thing', () => {
  it('puts the listing in the subject of every rejection', () => {
    for (const kind of REJECTION_EMAIL_KINDS) {
      const body = renderApprovalEmail({
        kind,
        title: 'Kettering University Field House',
        reviewerNote: REASON,
        preferencesUrl: PREFS,
      })
      expect(body.subject).toContain('Kettering University Field House')
    }
  })

  it('carries the identifying facts so the reader knows which one it was', () => {
    const body = renderApprovalEmail({
      kind: 'event_removed',
      title: 'Kettering Kickoff',
      facts: [
        { label: 'Dates', value: '12 to 13 July 2026' },
        { label: 'Where', value: 'Flint, Michigan, USA' },
      ],
      reviewerNote: REASON,
      preferencesUrl: PREFS,
    })
    expect(body.text).toContain('Dates: 12 to 13 July 2026')
    expect(body.text).toContain('Where: Flint, Michigan, USA')
  })

  it('does not apologise or explain what a practice field is', () => {
    for (const kind of REJECTION_EMAIL_KINDS) {
      const body = renderApprovalEmail({ kind, title: 'Something', reviewerNote: REASON, preferencesUrl: PREFS })
      expect(body.text.toLowerCase()).not.toContain('we are sorry')
      expect(body.text.toLowerCase()).not.toContain('unfortunately')
      expect(body.text.toLowerCase()).not.toContain('apologise')
      expect(body.text).not.toContain('—')
    }
  })
})

describe('rejection dedupe keys', () => {
  it('separate a refusal from a takedown of the same thing', () => {
    // A field can be refused, restored, published, and later taken down. Both
    // are outcomes about the same row and the submitter should hear about both.
    for (const [rejected, removed] of REMOVED_VS_REJECTED) {
      expect(notificationDedupeKey(rejected, 'subject-1', 'user-1')).not.toBe(
        notificationDedupeKey(removed, 'subject-1', 'user-1'),
      )
    }
  })

  it('separate a rejection from the approval of the same thing', () => {
    expect(notificationDedupeKey('field_published', 'field-1', 'user-1')).not.toBe(
      notificationDedupeKey('field_rejected', 'field-1', 'user-1'),
    )
  })

  it('collapse a second click on the same decision onto one email', () => {
    expect(notificationDedupeKey('tool_removed', 'sub-1', 'user-1')).toBe(
      notificationDedupeKey('tool_removed', 'sub-1', 'user-1'),
    )
  })
})
