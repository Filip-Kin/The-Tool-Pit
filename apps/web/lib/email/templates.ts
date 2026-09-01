/**
 * Alert email bodies.
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
 *
 * ZERO imports on purpose. This module is pure string building so it can be
 * called from a server component, a server action or a test without dragging
 * in the DB client or React.
 *
 * MIRRORED IN THE WORKER: apps/worker/src/grants/alerts.ts renders the same
 * three bodies for the outbox drain. It cannot import this file, because the
 * worker's tsconfig sets `rootDir: ./src` and tsc refuses any source outside
 * it (TS6059). The fix is to lift this module into packages/types, which both
 * apps already depend on. Until that happens, treat THIS file as canonical and
 * change the worker copy in the same commit.
 */

// #region shared

export interface EmailBody {
  subject: string
  html: string
  text: string
}

/** Escape for interpolation into HTML text or an attribute value. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Format a deadline for an email.
 *
 * An email cannot know the reader's clock, so it has to pick one zone and name
 * it. We default to US Eastern because the grants in this vertical are almost
 * all US funders quoting US closing times, and an unlabelled time is worse
 * than a labelled one in the wrong zone. `timeZoneName: 'short'` means the
 * reader always sees which zone they are being told.
 */
export function formatDeadline(at: Date, timeZone = 'America/New_York'): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(at)
}

/** Money as a plain range. Returns null when we do not know the size. */
export function formatAward(min: number | null, max: number | null, currency = 'USD'): string | null {
  const symbol = currency === 'USD' ? '$' : `${currency} `
  const n = (v: number) => `${symbol}${v.toLocaleString('en-US')}`
  if (min != null && max != null) return min === max ? n(min) : `${n(min)} to ${n(max)}`
  if (max != null) return `up to ${n(max)}`
  if (min != null) return `from ${n(min)}`
  return null
}

interface LayoutInput {
  /** Big line at the top. Usually the same as the subject, minus the prefix. */
  heading: string
  /** Body paragraphs, already plain text. Rendered in order. */
  paragraphs: string[]
  /** Optional label/value rows, e.g. Deadline, Award, Funder. */
  facts?: Array<{ label: string; value: string }>
  cta?: { label: string; url: string }
  /** Why this person is getting this email. One short sentence. */
  reason: string
  preferencesUrl: string
}

/**
 * One layout for every alert. Inline styles only, because email clients strip
 * <style> blocks, and a light background because most clients ignore
 * prefers-color-scheme and would otherwise render dark text on dark.
 */
function layout(input: LayoutInput): { html: string; text: string } {
  const { heading, paragraphs, facts = [], cta, reason, preferencesUrl } = input

  const factRows = facts
    .map(
      (f) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#666;font-size:14px;vertical-align:top;white-space:nowrap">${esc(f.label)}</td>` +
        `<td style="padding:4px 0;color:#111;font-size:14px">${esc(f.value)}</td></tr>`,
    )
    .join('')

  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f5">',
    '<div style="max-width:560px;margin:0 auto;padding:24px 20px;background:#ffffff;',
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;',
    'color:#111;line-height:1.5">',
    `<h1 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111">${esc(heading)}</h1>`,
    ...paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;color:#111">${esc(p)}</p>`),
    factRows
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">${factRows}</table>`
      : '',
    cta
      ? `<p style="margin:20px 0"><a href="${esc(cta.url)}" style="display:inline-block;padding:10px 16px;` +
        `background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-size:15px">${esc(cta.label)}</a></p>`
      : '',
    '<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0 12px">',
    `<p style="margin:0 0 6px;font-size:12px;color:#666">${esc(reason)}</p>`,
    `<p style="margin:0;font-size:12px;color:#666"><a href="${esc(preferencesUrl)}" style="color:#4f46e5">Manage these emails</a></p>`,
    '</div></body></html>',
  ]
    .filter(Boolean)
    .join('')

  const text = [
    heading,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(facts.length ? [...facts.map((f) => `${f.label}: ${f.value}`), ''] : []),
    ...(cta ? [`${cta.label}: ${cta.url}`, ''] : []),
    '--',
    reason,
    `Manage these emails: ${preferencesUrl}`,
  ].join('\n')

  return { html, text }
}

// #endregion

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
  paragraphs.push('Check the funder’s own page before you apply. We match on what we have recorded, and the funder is always the last word.')

  const facts: Array<{ label: string; value: string }> = []
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
}

export function renderDeadlineEmail(input: DeadlineEmailInput): EmailBody {
  const days =
    input.daysLeft <= 0 ? 'Closes today' : input.daysLeft === 1 ? '1 day left' : `${input.daysLeft} days left`

  const paragraphs = [`${days} to apply for ${input.grantName}.`]

  if (input.verifiedAt) {
    paragraphs.push(`These dates were last confirmed against the funder’s page on ${formatDeadline(input.verifiedAt).split(',')[1]?.trim() ?? formatDeadline(input.verifiedAt)}.`)
  } else {
    // We only ever remind on a funder-published date, so this branch means the
    // date is published but nobody has re-checked it lately. Say so plainly.
    paragraphs.push('Nobody has re-checked this date recently, so open the funder’s page before you rely on it.')
  }

  const facts: Array<{ label: string; value: string }> = [
    { label: 'Deadline', value: formatDeadline(input.deadlineAt) },
  ]
  if (input.deadlineNote) facts.push({ label: 'Funder’s wording', value: input.deadlineNote })
  if (input.funderName) facts.push({ label: 'Funder', value: input.funderName })

  const { html, text } = layout({
    heading: `${days}: ${input.grantName}`,
    paragraphs,
    facts,
    cta: { label: input.applicationUrl ? 'Start the application' : 'Open the listing', url: input.applicationUrl || input.grantUrl },
    reason: 'You are getting this because you are watching this grant.',
    preferencesUrl: input.preferencesUrl,
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
}

export function renderGrantChangeEmail(input: GrantChangeEmailInput): EmailBody {
  const paragraphs = [`Something changed on the ${input.grantName} listing.`]

  if (input.awaitingReview) {
    // The whole product promise is that a scraped fact is not a published
    // fact. If a moderator has not seen it yet, the email has to say so rather
    // than let the reader assume it is confirmed.
    paragraphs.push('This came off the funder’s page automatically and a moderator has not confirmed it yet. Treat it as a heads-up, not as fact.')
  }

  const { html, text } = layout({
    heading: `Listing changed: ${input.grantName}`,
    paragraphs,
    facts: input.changes.slice(0, 8).map((c, i) => ({ label: i === 0 ? 'Changed' : '', value: c })),
    cta: { label: 'Open the listing', url: input.grantUrl },
    reason: 'You are getting this because you are watching this grant.',
    preferencesUrl: input.preferencesUrl,
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
  })

  return { subject: 'Confirm your email for grant alerts', html, text }
}

// #endregion
