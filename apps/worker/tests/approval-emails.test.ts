import { describe, it, expect } from 'vitest'
import {
  APPROVAL_EMAIL_KINDS,
  isApprovalEmailKind,
  renderApprovalEmail,
  type ApprovalEmailKind,
} from '@the-tool-pit/types'

/**
 * The bodies a submitter actually receives.
 *
 * The thing worth testing here is not the HTML, it is the promise the copy
 * makes: the email names the thing, shows the detail that identifies it, links
 * to the live page, and a rejection does not read like an approval. Those are
 * the four ways this feature fails in an inbox.
 */

const PREFS = 'https://frc.tools/me/notifications'

describe('renderApprovalEmail', () => {
  it('names the thing in the subject, so an inbox six weeks later still means something', () => {
    const body = renderApprovalEmail({
      kind: 'field_published',
      title: 'Kettering University Field House',
      url: 'https://frc.tools/fields/abc',
      preferencesUrl: PREFS,
    })

    expect(body.subject).toContain('Kettering University Field House')
    // The generic phrasing is the failure mode, not a valid fallback.
    expect(body.subject).not.toBe('Your submission was approved')
  })

  it('shows the identifying facts and links to the live page', () => {
    const body = renderApprovalEmail({
      kind: 'field_published',
      title: 'Kettering University Field House',
      url: 'https://frc.tools/fields/abc',
      facts: [
        { label: 'Where', value: 'Flint, Michigan, USA' },
        { label: 'Host', value: 'Team 3538' },
      ],
      preferencesUrl: PREFS,
    })

    expect(body.html).toContain('Flint, Michigan, USA')
    expect(body.html).toContain('Team 3538')
    expect(body.html).toContain('href="https://frc.tools/fields/abc"')
    // The plain-text twin has to carry the same facts, not just the heading.
    expect(body.text).toContain('Where: Flint, Michigan, USA')
    expect(body.text).toContain('https://frc.tools/fields/abc')
  })

  it('lists the specific edits that were applied, not just that "an edit" went through', () => {
    const body = renderApprovalEmail({
      kind: 'field_edit_applied',
      title: 'Kettering University Field House',
      url: 'https://frc.tools/fields/abc',
      changes: ['Hours updated', 'Contact updated'],
      preferencesUrl: PREFS,
    })

    expect(body.html).toContain('Hours updated')
    expect(body.html).toContain('Contact updated')
    expect(body.text).toContain('Applied: Hours updated')
  })

  it('caps a proposal that rewrote everything rather than printing twelve rows', () => {
    const changes = Array.from({ length: 12 }, (_, i) => `Thing ${i + 1} updated`)
    const body = renderApprovalEmail({
      kind: 'field_edit_applied',
      title: 'A field',
      changes,
      preferencesUrl: PREFS,
    })

    expect(body.html).toContain('Thing 8 updated')
    expect(body.html).not.toContain('Thing 9 updated')
    expect(body.html).toContain('and 4 more')
  })

  it('drops blank change rows instead of rendering empty table cells', () => {
    const body = renderApprovalEmail({
      kind: 'field_edit_applied',
      title: 'A field',
      changes: ['   ', 'Notes updated', ''],
      preferencesUrl: PREFS,
    })

    expect(body.text).toContain('Applied: Notes updated')
    expect(body.text).not.toMatch(/Applied: *\n/)
  })

  it('does not read like an approval when the answer was no', () => {
    const approved = renderApprovalEmail({
      kind: 'claim_approved',
      title: 'AdvantageKit',
      preferencesUrl: PREFS,
    })
    const rejected = renderApprovalEmail({
      kind: 'claim_rejected',
      title: 'AdvantageKit',
      preferencesUrl: PREFS,
    })

    expect(approved.subject).not.toEqual(rejected.subject)
    expect(rejected.subject).toContain('not approved')
    // Says what happened to the thing they asked for, in the body as well.
    expect(rejected.text).toContain('did not approve it')
  })

  it('carries the reviewer’s note verbatim on a rejection', () => {
    const note = 'The repo belongs to team 254 and you have not shown a connection to it.'
    const body = renderApprovalEmail({
      kind: 'claim_rejected',
      title: 'AdvantageKit',
      reviewerNote: note,
      preferencesUrl: PREFS,
    })

    expect(body.text).toContain(note)
    expect(body.html).toContain('The repo belongs to team 254')
  })

  it('leaves the button out rather than pointing it nowhere', () => {
    const withUrl = renderApprovalEmail({
      kind: 'album_published',
      title: 'Kettering Kickoff 2026',
      url: 'https://frc.tools/photos/event/2026miket',
      preferencesUrl: PREFS,
    })
    const withoutUrl = renderApprovalEmail({
      kind: 'album_published',
      title: 'Kettering Kickoff 2026',
      preferencesUrl: PREFS,
    })

    expect(withUrl.html).toContain('Open the event page')
    expect(withoutUrl.html).not.toContain('Open the event page')
    expect(withoutUrl.html).not.toContain('href=""')
  })

  it('escapes a title that contains HTML, because names are user input', () => {
    const body = renderApprovalEmail({
      kind: 'tool_published',
      title: '<script>alert(1)</script> Tool',
      preferencesUrl: PREFS,
    })

    expect(body.html).not.toContain('<script>')
    expect(body.html).toContain('&lt;script&gt;')
  })

  it('always carries a working preferences link and a plain-text twin', () => {
    for (const kind of APPROVAL_EMAIL_KINDS) {
      const body = renderApprovalEmail({ kind, title: 'Something', preferencesUrl: PREFS })
      expect(body.subject.length).toBeGreaterThan(0)
      expect(body.html).toContain(PREFS)
      expect(body.text).toContain(PREFS)
      expect(body.text.length).toBeGreaterThan(0)
    }
  })

  it('has no em dashes anywhere in the copy', () => {
    for (const kind of APPROVAL_EMAIL_KINDS) {
      const body = renderApprovalEmail({
        kind,
        title: 'Something',
        facts: [{ label: 'Where', value: 'Auckland' }],
        changes: ['Hours updated'],
        reviewerNote: 'A note.',
        preferencesUrl: PREFS,
      })
      expect(body.text).not.toContain('—')
      expect(body.html).not.toContain('—')
    }
  })

  it('falls back to a readable title rather than an empty subject', () => {
    const body = renderApprovalEmail({ kind: 'tool_published', title: '   ', preferencesUrl: PREFS })
    expect(body.subject).toContain('your submission')
  })
})

describe('isApprovalEmailKind', () => {
  it('accepts every kind the renderer handles', () => {
    for (const kind of APPROVAL_EMAIL_KINDS) {
      expect(isApprovalEmailKind(kind)).toBe(true)
    }
  })

  it('rejects anything else, which is what stops the drain sending a blank email', () => {
    expect(isApprovalEmailKind('field_approved')).toBe(false)
    expect(isApprovalEmailKind('')).toBe(false)
    expect(isApprovalEmailKind(null)).toBe(false)
    expect(isApprovalEmailKind(undefined)).toBe(false)
    expect(isApprovalEmailKind(7)).toBe(false)
  })
})

describe('the kind list', () => {
  it('covers every moderation outcome that has somebody to tell', () => {
    // A guard, not a tautology: adding a queue with a submitter and forgetting
    // to add its kind here is how a vertical silently goes back to telling
    // nobody. If this list changes, the wiring in apps/web has to change too.
    const expected: ApprovalEmailKind[] = [
      'field_published',
      'field_edit_applied',
      'event_published',
      'tool_published',
      'album_published',
      'grant_published',
      'claim_approved',
      'claim_rejected',
      'listing_invite',
      // Every moderation action does double duty: it refuses something pending
      // AND takes down something already live. One email cannot be right for
      // both, so each vertical has two kinds and the action picks by reading
      // the status before it writes. See rejection-emails.test.ts.
      'field_rejected',
      'field_removed',
      'event_rejected',
      'event_removed',
      'tool_rejected',
      'tool_removed',
      'album_rejected',
      'album_removed',
      'grant_rejected',
      'grant_removed',
      'submission_rejected',
      'field_edit_rejected',
    ]
    expect([...APPROVAL_EMAIL_KINDS]).toEqual(expected)
  })
})
