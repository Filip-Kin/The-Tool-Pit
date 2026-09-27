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
import {
  formatAward,
  formatDeadline,
  layout,
  type EmailBody,
  type EmailListItem,
  type EmailSection,
} from './layout'

// #region daily digest

/** Most items one digest section lists before it links to the rest. */
export const GRANT_DIGEST_SECTION_CAP = 10

/** One grant in a digest section. Dates are Dates, parsed by the caller. */
export interface GrantDigestItem {
  grantName: string
  grantUrl: string
  funderName?: string | null
  awardMin?: number | null
  awardMax?: number | null
  awardCurrency?: string | null
  deadlineAt?: Date | null
  deadlineNote?: string | null
}

/** Everything one digest says about one team profile. */
export interface GrantDigestGroup {
  /** e.g. "FRC team 3476". Null for rows with no team, e.g. a watched grant. */
  teamLabel: string | null
  /** Deadline reminders. Every item here has a deadlineAt. */
  closingSoon: GrantDigestItem[]
  newMatches: GrantDigestItem[]
}

export interface GrantDigestEmailInput {
  groups: GrantDigestGroup[]
  /** Send time, for the days-left count. */
  now: Date
  /** Where "and N more" points. */
  moreUrl: string
  preferencesUrl: string
  /** No-login "unsubscribe from everything" link for this recipient. */
  unsubscribeUrl?: string
}

function daysLeftLabel(at: Date, now: Date): string {
  const days = Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 86_400_000))
  return days <= 0 ? 'Closes today' : days === 1 ? '1 day left' : `${days} days left`
}

function closingItem(item: GrantDigestItem, now: Date): EmailListItem {
  const at = item.deadlineAt as Date
  const when = `${daysLeftLabel(at, now)} · ${formatDeadline(at)}`
  // The funder's own wording stays verbatim beside the date: "5pm PT on the
  // Friday" and our converted timestamp are both real and both matter.
  const details = [item.deadlineNote ? `${when} · ${item.deadlineNote}` : when]
  if (item.funderName) details.push(item.funderName)
  return { title: item.grantName, url: item.grantUrl, details }
}

function newMatchItem(item: GrantDigestItem): EmailListItem {
  const award = formatAward(item.awardMin ?? null, item.awardMax ?? null, item.awardCurrency ?? 'USD')
  const first = [item.funderName, award].filter(Boolean).join(' · ')
  const details = first ? [first] : []
  if (item.deadlineAt) details.push(`Deadline ${formatDeadline(item.deadlineAt)}`)
  return { title: item.grantName, url: item.grantUrl, details }
}

/** One capped section, with the "and N more" line when the cap cut it. */
function capped(
  heading: string,
  level: 2 | 3,
  items: EmailListItem[],
  moreUrl: string,
): EmailSection | null {
  if (items.length === 0) return null
  const extra = items.length - GRANT_DIGEST_SECTION_CAP
  return {
    heading,
    level,
    items: items.slice(0, GRANT_DIGEST_SECTION_CAP),
    more: extra > 0 ? { label: `and ${extra} more`, url: moreUrl } : undefined,
  }
}

/** "Grants for FRC team 3476", "Grants for FRC team 3476 and FRC team 254", "Grants for 3 teams". */
function digestTitle(groups: GrantDigestGroup[]): string {
  const labels = groups.map((g) => g.teamLabel).filter((l): l is string => !!l)
  if (labels.length === 0) return 'Grants'
  if (labels.length === 1) return `Grants for ${labels[0]}`
  if (labels.length === 2) return `Grants for ${labels[0]} and ${labels[1]}`
  return `Grants for ${labels.length} teams`
}

/**
 * The one daily grant email: every due match and deadline reminder for one
 * person, grouped by team profile. Replaces one email per alert row, which sent
 * a new profile's mentor 35 emails in a few minutes on its first sweep.
 */
export function renderGrantDigestEmail(input: GrantDigestEmailInput): EmailBody {
  const groups = input.groups.filter((g) => g.closingSoon.length + g.newMatches.length > 0)
  const multi = groups.length > 1

  const sections: EmailSection[] = []
  let newCount = 0
  let closingCount = 0

  for (const group of groups) {
    const closing = [...group.closingSoon]
      .filter((i) => i.deadlineAt)
      .sort((a, b) => (a.deadlineAt as Date).getTime() - (b.deadlineAt as Date).getTime())
    newCount += group.newMatches.length
    closingCount += closing.length

    const level = multi ? 3 : 2
    if (multi) sections.push({ heading: group.teamLabel ?? 'Other grants', level: 2, items: [] })
    const soon = capped('Closing soon', level, closing.map((i) => closingItem(i, input.now)), input.moreUrl)
    const fresh = capped('New matches', level, group.newMatches.map(newMatchItem), input.moreUrl)
    if (soon) sections.push(soon)
    if (fresh) sections.push(fresh)
  }

  const title = digestTitle(groups)
  const counts = [newCount ? `${newCount} new` : '', closingCount ? `${closingCount} closing soon` : '']
    .filter(Boolean)
    .join(', ')
  const subject = counts ? `${title}: ${counts}` : title

  const { html, text } = layout({
    heading: title,
    paragraphs: [],
    sections,
    reason: 'Daily grant digest: team profiles and watched grants',
    preferencesUrl: input.preferencesUrl,
    unsubscribeUrl: input.unsubscribeUrl,
  })

  return { subject, html, text }
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
      'Somebody added this address to an FRC.Tools account for grant alerts. Confirm it and deadline reminders and new matches will arrive here.',
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
