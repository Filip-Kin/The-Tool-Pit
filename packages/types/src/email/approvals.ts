/**
 * Moderation outcome emails: "the thing you submitted is now live", and the
 * one case where the answer was no.
 *
 * Every vertical on the site takes public submissions and holds them for a
 * human. Until now the person who submitted heard nothing back, so the only
 * way to find out was to keep reloading the map. These bodies close that loop.
 *
 * THREE RULES THE COPY KEEPS:
 *
 *   1. NAME THE THING. "Your submission was approved" is useless in an inbox
 *      six weeks later. Every body leads with what it was, carries the facts
 *      that identify it (city, dates, team, the actual edit that was applied)
 *      and links straight to the live page.
 *   2. SAY WHAT HAPPENED, NOT WHAT THE READER SHOULD FEEL. No thanking them
 *      three times, no explaining what a practice field is to the person who
 *      just listed one.
 *   3. A REJECTION IS NOT AN APPROVAL. It gets its own subject, its own body,
 *      and the reviewer's note verbatim when there is one, because "no" with
 *      no reason is the thing people write back about.
 *
 * Anonymous submissions never reach here: the queue row that drives these has
 * a non-null user id or it is never written.
 */
import { layout, type EmailBody, type EmailFact } from './layout'

// #region kinds

/**
 * One kind per moderation outcome we email about.
 *
 * These strings are persisted on outbox rows, so they are an on-disk contract:
 * rename one and every queued row of that kind stops rendering. Add, never
 * rewrite.
 */
export const APPROVAL_EMAIL_KINDS = [
  /** A practice field submission was published to the map. */
  'field_published',
  /** A suggested edit to a published field was applied. */
  'field_edit_applied',
  /** An off-season event listing was published. */
  'event_published',
  /** A tool, robot code or CAD submission reached the directory. */
  'tool_published',
  /** A photo album submission was attached to its event and published. */
  'album_published',
  /** A submitted grant was checked and listed. */
  'grant_published',
  /** An admin approved a claim, so the claimant can now edit the listing. */
  'claim_approved',
  /** An admin reviewed a claim and said no. */
  'claim_rejected',

  // #region the answer was no
  //
  // EVERY MODERATION ACTION HERE DOES DOUBLE DUTY, and that is why there are
  // two kinds for each vertical rather than one.
  //
  // suppressField, suppressEvent, suppressCandidate, suppressAlbumCandidate and
  // suppressGrantCandidate all set the same column to the same value. What that
  // MEANS depends entirely on what the row was a second earlier. On a pending
  // submission it means "we read this and we are not listing it". On a
  // published listing it means "this was live, people could find it, and it is
  // gone now". Those are not the same news and one email cannot be right for
  // both: telling somebody their field "was not accepted" when it has been on
  // the map for six months reads as though we lost it.
  //
  // So the action reads the status BEFORE it writes, and picks the kind from
  // what it found. A REASON IS REQUIRED on all of them, and it is the body of
  // the email, because "no" with no reason is the thing people write back about.

  /** A pending practice field was reviewed and not listed. */
  'field_rejected',
  /** A practice field that was live on the map was taken down. */
  'field_removed',
  /** A pending off-season event listing was reviewed and not listed. */
  'event_rejected',
  /** An off-season event that was live was taken down. */
  'event_removed',
  /** A pending tool, robot code or CAD candidate was reviewed and not listed. */
  'tool_rejected',
  /** A tool listing that was live in the directory was taken down. */
  'tool_removed',
  /** A pending album was reviewed and not listed. */
  'album_rejected',
  /** An album that was live against its event was taken down. */
  'album_removed',
  /** A pending grant was reviewed and not listed. */
  'grant_rejected',
  /** A grant that was live in the directory was taken down. */
  'grant_removed',
  /** A submission was rejected before it ever became a candidate. */
  'submission_rejected',
  /** A suggested edit to a published field was not applied. */
  'field_edit_rejected',
  // #endregion
] as const

export type ApprovalEmailKind = (typeof APPROVAL_EMAIL_KINDS)[number]

export function isApprovalEmailKind(value: unknown): value is ApprovalEmailKind {
  return typeof value === 'string' && (APPROVAL_EMAIL_KINDS as readonly string[]).includes(value)
}

/**
 * The kinds that carry bad news, and therefore the kinds that MUST carry a
 * reason. Exported so the queueing side can refuse to write one without.
 */
export const REJECTION_EMAIL_KINDS = [
  'claim_rejected',
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
] as const

export type RejectionEmailKind = (typeof REJECTION_EMAIL_KINDS)[number]

export function isRejectionEmailKind(value: unknown): value is RejectionEmailKind {
  return typeof value === 'string' && (REJECTION_EMAIL_KINDS as readonly string[]).includes(value)
}

// #endregion

// #region input

/**
 * The facts an outcome email needs, as they are stored on the outbox row.
 *
 * A TYPE ALIAS, not an interface, and that is load-bearing: the payload column
 * is jsonb typed as Record<string, unknown>, and TypeScript only gives implicit
 * index signatures to type aliases. An interface here would not assign.
 *
 * Self-contained on purpose. The drain never re-reads the listing at send time,
 * so a field renamed after approval cannot rewrite an email already promised,
 * and a deleted listing cannot make a queued row unrenderable.
 */
export type ApprovalEmailPayload = {
  /**
   * The thing, named the way its owner would name it. A field's name, a tool's
   * name, an event's name. Never an id and never "your submission".
   */
  title: string
  /**
   * Absolute URL of the live page, on frc.tools. Optional because a couple of
   * verticals land the reader on a list rather than a page of their own, and a
   * button pointing nowhere is worse than no button.
   */
  url?: string | null
  /** Identifying detail: city, dates, team number, the album's event. */
  facts?: EmailFact[]
  /**
   * For an accepted edit, the specific changes that went live. Shown as their
   * own rows so the reader can see which of their suggestions was taken.
   */
  changes?: string[]
  /** A reviewer's note. Always shown on a rejection, and on an approval if set. */
  reviewerNote?: string | null
}

export interface ApprovalEmailInput extends ApprovalEmailPayload {
  kind: ApprovalEmailKind
  preferencesUrl: string
}

// #endregion

// #region copy

interface KindCopy {
  /** Subject and heading. `{title}` is substituted. */
  subject: string
  /** Lead paragraph. `{title}` is substituted. */
  lead: string
  /** Extra paragraphs after the lead. */
  extra?: string[]
  /** CTA label, used only when a url was passed. */
  cta: string
  /** The footer line explaining why this arrived in their inbox. */
  reason: string
  /**
   * Label on the reviewer's note row. Defaults to "Reviewer's note", which is
   * right on an approval and wrong on a rejection: there the note is not a
   * remark alongside the decision, it IS the decision, so it is labelled Why.
   */
  noteLabel?: string
}

const COPY: Record<ApprovalEmailKind, KindCopy> = {
  field_published: {
    subject: 'Your practice field is on the map: {title}',
    lead: '{title} is published, so teams looking for a field near you can find it now.',
    cta: 'Open the field',
    reason: 'You are getting this because you submitted this field while signed in.',
  },
  field_edit_applied: {
    subject: 'Your edit to {title} is live',
    lead: 'The changes you suggested to {title} have been applied.',
    cta: 'Open the field',
    reason: 'You are getting this because you suggested this edit while signed in.',
  },
  event_published: {
    subject: 'Your event listing is live: {title}',
    lead: '{title} is published, so it now shows on the off-season events map and list.',
    cta: 'Open the listing',
    reason: 'You are getting this because you submitted this event while signed in.',
  },
  tool_published: {
    subject: 'Your submission is listed: {title}',
    lead: '{title} is published in the directory and will turn up in search.',
    cta: 'Open the listing',
    reason: 'You are getting this because you submitted this while signed in.',
  },
  album_published: {
    subject: 'Your album is listed: {title}',
    lead: '{title} is published and attached to its event.',
    cta: 'Open the event page',
    reason: 'You are getting this because you submitted this album while signed in.',
  },
  grant_published: {
    subject: 'The grant you sent us is listed: {title}',
    lead: '{title} is published in the grants directory.',
    extra: [
      'A moderator read the funder’s page and checked the dates before it went up, so what is listed may differ from what you sent.',
    ],
    cta: 'Open the listing',
    reason: 'You are getting this because you submitted this grant while signed in.',
  },
  claim_approved: {
    subject: 'You now manage {title}',
    lead: 'Your claim on {title} was approved. You can edit it and invite other people to help from your listings page.',
    cta: 'Open your listings',
    reason: 'You are getting this because you claimed this listing.',
  },
  claim_rejected: {
    subject: 'Your claim on {title} was not approved',
    lead: 'An admin reviewed your claim on {title} and did not approve it, so nothing has changed about who can edit it.',
    extra: [
      'If you can point at something that shows the connection, a repository you can commit to or a page that names you, start a new claim with that detail.',
    ],
    cta: 'Open your listings',
    reason: 'You are getting this because you claimed this listing.',
    noteLabel: 'Why',
  },

  // #region the answer was no
  //
  // WHAT THE COPY DOES, AND WHAT IT REFUSES TO DO.
  //
  // It says what happened, names the thing, and hands over the reason. It does
  // not apologise three times, it does not explain what a practice field is to
  // the person who just listed one, and it does not soften a takedown into an
  // approval that went slightly wrong. A "rejected" line and a "removed" line
  // are different sentences because they are different events.
  //
  // No url is passed on these. A rejected submission has no page, and linking a
  // removed listing to the page it is no longer on is worse than no button.

  field_rejected: {
    subject: 'We did not list your practice field: {title}',
    lead: '{title} is not going on the practice field map. The reason is below.',
    extra: ['If that is something you can sort out, send the field in again and we will look at it fresh.'],
    cta: 'Open the map',
    reason: 'You are getting this because you submitted this field while signed in.',
    noteLabel: 'Why',
  },
  field_removed: {
    subject: 'We removed your practice field from the map: {title}',
    lead: '{title} was on the practice field map and is not any more. The reason is below.',
    extra: ['If the reason no longer holds, tell us and we will put it back.'],
    cta: 'Open the map',
    reason: 'You are getting this because you submitted this field while signed in.',
    noteLabel: 'Why',
  },
  event_rejected: {
    subject: 'We did not list your event: {title}',
    lead: '{title} is not going on the off-season events map. The reason is below.',
    extra: ['If that is something you can sort out, send the event in again and we will look at it fresh.'],
    cta: 'Open the events map',
    reason: 'You are getting this because you submitted this event while signed in.',
    noteLabel: 'Why',
  },
  event_removed: {
    subject: 'We removed your event listing: {title}',
    lead: '{title} was on the off-season events map and is not any more. The reason is below.',
    extra: ['If the reason no longer holds, tell us and we will put it back.'],
    cta: 'Open the events map',
    reason: 'You are getting this because you submitted this event while signed in.',
    noteLabel: 'Why',
  },
  tool_rejected: {
    subject: 'We did not list your submission: {title}',
    lead: '{title} is not going in the directory. The reason is below.',
    extra: ['If that is something you can sort out, send it in again and we will look at it fresh.'],
    cta: 'Open the directory',
    reason: 'You are getting this because you submitted this while signed in.',
    noteLabel: 'Why',
  },
  tool_removed: {
    subject: 'We removed your listing: {title}',
    lead: '{title} was in the directory and is not any more. The reason is below.',
    extra: ['If the reason no longer holds, tell us and we will put it back.'],
    cta: 'Open the directory',
    reason: 'You are getting this because you submitted this while signed in.',
    noteLabel: 'Why',
  },
  album_rejected: {
    subject: 'We did not list your album: {title}',
    lead: '{title} is not going in the photo directory. The reason is below.',
    extra: ['If that is something you can sort out, send the album in again and we will look at it fresh.'],
    cta: 'Open the photos',
    reason: 'You are getting this because you submitted this album while signed in.',
    noteLabel: 'Why',
  },
  album_removed: {
    subject: 'We removed your album: {title}',
    lead: '{title} was listed against its event and is not any more. The reason is below.',
    extra: ['If the reason no longer holds, tell us and we will put it back.'],
    cta: 'Open the photos',
    reason: 'You are getting this because you submitted this album while signed in.',
    noteLabel: 'Why',
  },
  grant_rejected: {
    subject: 'We did not list the grant you sent us: {title}',
    lead: '{title} is not going in the grants directory. The reason is below.',
    extra: ['A moderator reads the funder’s own page before a grant goes up, so this is about what that page says rather than about what you wrote.'],
    cta: 'Open the grants directory',
    reason: 'You are getting this because you submitted this grant while signed in.',
    noteLabel: 'Why',
  },
  grant_removed: {
    subject: 'We removed a grant listing: {title}',
    lead: '{title} was in the grants directory and is not any more. The reason is below.',
    extra: ['If the reason no longer holds, tell us and we will put it back.'],
    cta: 'Open the grants directory',
    reason: 'You are getting this because you submitted this grant while signed in.',
    noteLabel: 'Why',
  },
  submission_rejected: {
    subject: 'We did not list your submission: {title}',
    lead: 'We read what you sent and {title} is not going in the directory. The reason is below.',
    extra: ['If that is something you can sort out, send it in again and we will look at it fresh.'],
    cta: 'Open the directory',
    reason: 'You are getting this because you submitted this while signed in.',
    noteLabel: 'Why',
  },
  field_edit_rejected: {
    subject: 'Your edit to {title} was not applied',
    lead: 'The changes you suggested to {title} were not applied, so the listing reads the way it did. The reason is below.',
    cta: 'Open the field',
    reason: 'You are getting this because you suggested this edit while signed in.',
    noteLabel: 'Why',
  },
  // #endregion
}

// #endregion

// #region render

/**
 * Render one moderation outcome.
 *
 * The layout, the facts table and the plain-text twin all come from the shared
 * layout(), so these read like every other email the site sends rather than
 * like a second product.
 */
export function renderApprovalEmail(input: ApprovalEmailInput): EmailBody {
  const copy = COPY[input.kind]
  const title = input.title.trim() || 'your submission'
  const subject = copy.subject.replace('{title}', title)

  const paragraphs = [copy.lead.replace('{title}', title), ...(copy.extra ?? [])]

  const facts: EmailFact[] = [...(input.facts ?? [])]

  // An accepted edit is the one case where "what was approved" is a list of
  // changes rather than a thing, so the changes get their own rows under a
  // single label. Capped: a proposal that rewrote twelve fields does not need
  // twelve rows in an email that already links to the result.
  const changes = (input.changes ?? []).filter((c) => c.trim().length > 0)
  if (changes.length > 0) {
    const shown = changes.slice(0, 8)
    shown.forEach((c, i) => facts.push({ label: i === 0 ? 'Applied' : '', value: c }))
    if (changes.length > shown.length) {
      facts.push({ label: '', value: `and ${changes.length - shown.length} more` })
    }
  }

  const note = input.reviewerNote?.trim()
  if (note) facts.push({ label: copy.noteLabel ?? 'Reviewer’s note', value: note })

  const { html, text } = layout({
    heading: subject,
    paragraphs,
    facts,
    cta: input.url ? { label: copy.cta, url: input.url } : undefined,
    reason: copy.reason,
    preferencesUrl: input.preferencesUrl,
  })

  return { subject, html, text }
}

// #endregion
