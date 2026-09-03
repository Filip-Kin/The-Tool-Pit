/**
 * The once-a-year "are you running it again" email for offseason events.
 *
 * It is an OUTBOX KIND, not a second mail system. It is written by
 * queueNotification into notification_outbox like every other notification, it
 * is picked up by the same drain in ./outbox.ts, it gets the same backoff, the
 * same parking, the same address resolution and the same unique index on
 * dedupe_key. The only thing this file adds is the body.
 *
 * WHY THE BODY IS NOT IN packages/types/src/email/approvals.ts WITH THE REST.
 * Two reasons, one of them temporary. The lasting one is that everything in
 * that file is a moderation OUTCOME, a "we looked at your submission and here
 * is what happened", and this is not: nobody submitted anything, we are asking
 * a question about a listing that is a year old. The temporary one is that
 * approvals.ts is being edited in another session right now, and a kind added
 * to a list in a file two people are writing is a merge conflict waiting to
 * happen. It renders through the same shared layout() so it looks like every
 * other email the site sends, and if these ever want to live in one list,
 * moving it is a copy and a rename with no schema change behind it.
 *
 * THE COPY. These are people who run robotics events off the side of a desk.
 * Say what we noticed, say what the link does, say what happens if they ignore
 * it, stop. No thanking them three times and no explaining the offseason to
 * somebody who ran one.
 */
import { layout, type EmailBody, type EmailFact } from '@the-tool-pit/types'

// #region kind

/**
 * The kind string written on the outbox row.
 *
 * PERSISTED, so it is an on-disk contract exactly like APPROVAL_EMAIL_KINDS:
 * rename it and every queued row of this kind stops rendering and gets parked
 * as unrenderable. Add, never rewrite.
 */
export const SEASON_RENEWAL_EMAIL_KIND = 'event_season_renewal'

// #endregion

// #region payload

/**
 * Everything the body needs, as it is stored on the row.
 *
 * SELF-CONTAINED, the same rule the approval payloads keep: the drain never
 * re-reads the listing at send time, so a listing edited or deleted between
 * April and the send cannot rewrite or break an email already promised.
 */
export interface SeasonRenewalEmailPayload {
  /** The event, named the way its organiser names it. */
  title: string
  /** The season we are asking about, e.g. 2027. */
  seasonYear: number
  /** The season the listing they own belongs to, e.g. 2026. */
  previousSeasonYear: number
  /** Prefilled new-listing form: /events/submit?renew=<previous listing id>. */
  renewUrl: string
  /** Last year's listing, so they can check what we hold before they start. */
  previousUrl: string
  /** Identifying detail off last year's listing: when, where, size, cost. */
  facts?: EmailFact[]
}

/**
 * Is this jsonb blob a renewal payload we can render?
 *
 * Checked rather than cast because the payload column is jsonb and a row
 * queued by an older deploy is a real thing. A payload that fails here parks
 * the row with a reason on it instead of sending a half-empty email.
 */
export function isSeasonRenewalPayload(value: unknown): value is SeasonRenewalEmailPayload {
  if (!value || typeof value !== 'object') return false
  const p = value as Partial<SeasonRenewalEmailPayload>
  return (
    typeof p.title === 'string' &&
    p.title.trim().length > 0 &&
    Number.isInteger(p.seasonYear) &&
    Number.isInteger(p.previousSeasonYear) &&
    typeof p.renewUrl === 'string' &&
    p.renewUrl.length > 0
  )
}

// #endregion

// #region render

/** Render the renewal ask. Same layout, same footer, as every other email. */
export function renderSeasonRenewalEmail(
  payload: SeasonRenewalEmailPayload,
  preferencesUrl: string,
  unsubscribeUrl?: string,
): EmailBody {
  const title = payload.title.trim()
  const subject = `Are you running ${title} in ${payload.seasonYear}?`

  const paragraphs = [
    `${title} ran in ${payload.previousSeasonYear} and you manage its listing. The ` +
      `${payload.seasonYear} offseason map is open, so if it is happening again, this link starts ` +
      `the ${payload.seasonYear} listing with last year's venue, capacity, cost and links already ` +
      'filled in. You set the new dates.',
    `If it is not running this year, ignore this. The ${payload.previousSeasonYear} listing stays ` +
      'where it is and its link keeps working. This is the only email we send about it.',
  ]

  const facts: EmailFact[] = [...(payload.facts ?? [])]
  if (payload.previousUrl) {
    facts.push({ label: `${payload.previousSeasonYear} listing`, value: payload.previousUrl })
  }

  const { html, text } = layout({
    heading: subject,
    paragraphs,
    facts,
    cta: { label: `Start the ${payload.seasonYear} listing`, url: payload.renewUrl },
    reason: `You are getting this because you manage the ${payload.previousSeasonYear} listing for ${title} on frc.tools.`,
    preferencesUrl,
    unsubscribeUrl,
  })

  return { subject, html, text }
}

// #endregion
