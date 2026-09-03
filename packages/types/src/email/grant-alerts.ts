/**
 * Grant alert email bodies.
 *
 * Plain HTML and a plain-text twin for every alert kind. No images, no
 * tracking pixel, no marketing voice: these are operational notices about
 * money a team is trying to win, and they get read on a phone in a workshop.
 *
 * Two rules that shape everything here:
 *
 *   1. Never state a date we have not been given. A deadline line is only
 *      rendered when the caller passes one, and the funder's own wording
 *      (`deadlineNote`) is printed verbatim next to it, because "11:59pm ET"
 *      and "5pm PT on the Friday" are real and different.
 *   2. Every email carries a working preferences link. There is no
 *      "unsubscribe by replying" and no dead footer.
 */
import { formatAward, formatDeadline, layout, type EmailBody, type EmailFact } from './layout'

// #region new match

export interface NewMatchEmailInput {
  grantName: string
  grantUrl: string
  funderName?: string | null
  teamLabel?: string | null
  /** 'eligible' or 'likely'. Anything else should not be emailed. */
  verdict: string
  awardMin?: number | null
  awardMax?: number | null
  awardCurrency?: string | null
  deadlineAt?: Date | null
  deadlineNote?: string | null
  /** Requirement labels the team passes. Shown so the match explains itself. */
  passedReasons?: string[]
  /** Requirement labels we could not test, so the team knows what is unproven. */
  unknownReasons?: string[]
  preferencesUrl: string
  /** No-login "unsubscribe from everything" link for this recipient. */
  unsubscribeUrl?: string
}

export function renderNewMatchEmail(input: NewMatchEmailInput): EmailBody {
  const who = input.teamLabel ? `${input.teamLabel} looks` : 'You look'
  const strength = input.verdict === 'eligible' ? 'eligible for' : 'a likely fit for'

  const paragraphs = [`${who} ${strength} ${input.grantName}.`]

  if (input.passedReasons?.length) {
    paragraphs.push(`Why: ${input.passedReasons.slice(0, 4).join('; ')}.`)
  }
  if (input.unknownReasons?.length) {
    // Named, never hidden. An untested requirement is the difference between
    // "you qualify" and "we could not check", and the team has to know which.
    paragraphs.push(
      `We could not check ${input.unknownReasons.slice(0, 3).join('; ')}. Fill those in on your team profile and the match gets firmer.`,
    )
  }
  paragraphs.push(
    'Check the funder’s own page before you apply. We match on what we have recorded, and the funder is always the last word.',
  )

  const facts: EmailFact[] = []
  if (input.funderName) facts.push({ label: 'Funder', value: input.funderName })
  const award = formatAward(input.awardMin ?? null, input.awardMax ?? null, input.awardCurrency ?? 'USD')
  if (award) facts.push({ label: 'Award', value: award })
  if (input.deadlineAt) facts.push({ label: 'Deadline', value: formatDeadline(input.deadlineAt) })
  if (input.deadlineNote) facts.push({ label: 'Funder’s wording', value: input.deadlineNote })

  const { html, text } = layout({
    heading: `New grant match: ${input.grantName}`,
    paragraphs,
    facts,
    cta: { label: 'Open the listing', url: input.grantUrl },
    reason: 'You are getting this because grant matching is on for your team.',
    preferencesUrl: input.preferencesUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  })

  return { subject: `New grant match: ${input.grantName}`, html, text }
}

// #endregion

// #region deadline

export interface DeadlineEmailInput {
  grantName: string
  grantUrl: string
  funderName?: string | null
  /** Real days remaining, computed from the deadline, not the reminder offset. */
  daysLeft: number
  deadlineAt: Date
  deadlineNote?: string | null
  applicationUrl?: string | null
  /** When a human last confirmed these dates against the funder's page. */
  verifiedAt?: Date | null
  preferencesUrl: string
  /** No-login "unsubscribe from everything" link for this recipient. */
  unsubscribeUrl?: string
}

export function renderDeadlineEmail(input: DeadlineEmailInput): EmailBody {
  const days =
    input.daysLeft <= 0 ? 'Closes today' : input.daysLeft === 1 ? '1 day left' : `${input.daysLeft} days left`

  const paragraphs = [`${days} to apply for ${input.grantName}.`]

  if (input.verifiedAt) {
    paragraphs.push(
      `These dates were last confirmed against the funder’s page on ${formatDeadline(input.verifiedAt).split(',')[1]?.trim() ?? formatDeadline(input.verifiedAt)}.`,
    )
  } else {
    // We only ever remind on a funder-published date, so this branch means the
    // date is published but nobody has re-checked it lately. Say so plainly.
    paragraphs.push('Nobody has re-checked this date recently, so open the funder’s page before you rely on it.')
  }

  const facts: EmailFact[] = [{ label: 'Deadline', value: formatDeadline(input.deadlineAt) }]
  if (input.deadlineNote) facts.push({ label: 'Funder’s wording', value: input.deadlineNote })
  if (input.funderName) facts.push({ label: 'Funder', value: input.funderName })

  const { html, text } = layout({
    heading: `${days}: ${input.grantName}`,
    paragraphs,
    facts,
    cta: {
      label: input.applicationUrl ? 'Start the application' : 'Open the listing',
      url: input.applicationUrl || input.grantUrl,
    },
    reason: 'You are getting this because you are watching this grant.',
    preferencesUrl: input.preferencesUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  })

  return { subject: `${days}: ${input.grantName}`, html, text }
}

// #endregion

// #region grant change

export interface GrantChangeEmailInput {
  grantName: string
  grantUrl: string
  /** Short human phrases, e.g. "Award max went from $2,000 to $5,000". */
  changes: string[]
  /** True when the change is still waiting on a human to confirm it. */
  awaitingReview?: boolean
  preferencesUrl: string
  /** No-login "unsubscribe from everything" link for this recipient. */
  unsubscribeUrl?: string
}

export function renderGrantChangeEmail(input: GrantChangeEmailInput): EmailBody {
  const paragraphs = [`Something changed on the ${input.grantName} listing.`]

  if (input.awaitingReview) {
    // The whole product promise is that a scraped fact is not a published
    // fact. If a moderator has not seen it yet, the email has to say so rather
    // than let the reader assume it is confirmed.
    paragraphs.push(
      'This came off the funder’s page automatically and a moderator has not confirmed it yet. Treat it as a heads-up, not as fact.',
    )
  }

  const { html, text } = layout({
    heading: `Listing changed: ${input.grantName}`,
    paragraphs,
    facts: input.changes.slice(0, 8).map((c, i) => ({ label: i === 0 ? 'Changed' : '', value: c })),
    cta: { label: 'Open the listing', url: input.grantUrl },
    reason: 'You are getting this because you are watching this grant.',
    preferencesUrl: input.preferencesUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  })

  return { subject: `Listing changed: ${input.grantName}`, html, text }
}

// #endregion

// #region channel verification

export interface VerifyEmailInput {
  verifyUrl: string
  /** Hours the link stays good, so the reader is not left guessing. */
  expiresInHours: number
  preferencesUrl: string
  /** No-login "unsubscribe from everything" link for this recipient. */
  unsubscribeUrl?: string
}

/**
 * Sent when someone adds an email address for alerts. Nothing else is ever
 * sent to an address until this link is clicked, so a signed-in user cannot
 * point grant alerts at somebody else's inbox.
 */
export function renderVerifyEmail(input: VerifyEmailInput): EmailBody {
  const { html, text } = layout({
    heading: 'Confirm this address for grant alerts',
    paragraphs: [
      'Somebody added this address to a Tool Pit account for grant alerts. Confirm it and deadline reminders and new matches will arrive here.',
      `The link works for ${input.expiresInHours} hours. If this was not you, ignore this email and nothing else will be sent here.`,
    ],
    cta: { label: 'Confirm this address', url: input.verifyUrl },
    reason: 'This is a one-off confirmation, not a subscription.',
    preferencesUrl: input.preferencesUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  })

  return { subject: 'Confirm your email for grant alerts', html, text }
}

// #endregion
