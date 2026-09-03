/**
 * Drain side of notification_outbox: moderation outcomes out as email.
 *
 * The write side is queueNotification() in @the-tool-pit/db, called from the
 * admin approval actions in apps/web and from the automatic publish path here
 * in the worker.
 *
 * This is the same drain as grants/alerts.ts, deliberately: the same attempt
 * cap, the same backoff, the same parking behaviour, the same stats. Two
 * drains that behave differently is two sets of failure modes to learn. What
 * is different is the payload, which is one shape for every kind rather than
 * one per kind, so rendering is a single call.
 *
 * WHERE IT RUNS. Inside the existing grant-alert-drain worker, not a queue of
 * its own. grants/mailer.ts paces sends with a module-level timestamp to stay
 * under Resend's 2 requests per second, and two drains running concurrently in
 * one process would step straight over that pacing. Sequential in the one
 * serial worker keeps one sender.
 */
import { and, asc, eq, isNull, lt, lte, sql } from 'drizzle-orm'
import {
  getDb,
  getMutedCategories,
  isEmailSuppressed,
  notificationOutbox,
  signUnsubscribe,
} from '@the-tool-pit/db'
import {
  emailCategoryForKind,
  isApprovalEmailKind,
  preferencesUrl,
  renderApprovalEmail,
  unsubscribeUrl,
  type ApprovalEmailPayload,
  type EmailBody,
} from '@the-tool-pit/types'
import { canDeliverTo, sandboxRefusalReason, sendEmail } from '../grants/mailer.js'
import { resolveEmailRecipient } from './recipients.js'
import {
  SEASON_RENEWAL_EMAIL_KIND,
  isSeasonRenewalPayload,
  renderSeasonRenewalEmail,
} from './season-renewal-email.js'

// #region policy

/**
 * How many delivery attempts one row gets before it is parked.
 *
 * Parked means "stop trying", not "deleted": the row keeps its error text and
 * an admin can requeue it by resetting `attempts`. There is no `failed` column,
 * so parking is expressed as attempts stamped at the cap, which is also what
 * keeps the row out of the next drain's SELECT.
 */
export const MAX_ATTEMPTS = 5

/** First retry gap. Doubles per attempt up to RETRY_MAX_MS. */
const RETRY_BASE_MS = 10 * 60 * 1000

/** Longest gap between retries. Beyond this, waiting longer helps nobody. */
const RETRY_MAX_MS = 6 * 60 * 60 * 1000

/**
 * How long a row waits for a deliverable address before it is given up on.
 *
 * Shorter than the grant alerts' 30 days on purpose. "Your field is on the map"
 * is worth reading a week late and is not worth reading two months late, and a
 * submitter who has not confirmed an address in a fortnight is not about to.
 */
const UNDELIVERABLE_GRACE_MS = 14 * 24 * 60 * 60 * 1000

/** How long to wait before re-checking whether a user has verified an address. */
const NO_CHANNEL_RETRY_MS = 12 * 60 * 60 * 1000

/** Most rows one drain pass will handle. Anything left over goes next pass. */
const DEFAULT_DRAIN_LIMIT = 200

/**
 * The address a reply lands in. Every email this drain sends carries it as
 * Reply-To, so an outreach recipient disputing a listing, or anyone else, can
 * just hit reply and reach a monitored inbox rather than the no-reply sender.
 */
const REPLY_TO = process.env.OUTREACH_REPLY_TO?.trim() || 'me@filipkin.com'

// #endregion

// #region rendering

/**
 * Render one queued row, or null when we have no body for it.
 *
 * Null is reported by the drain and parks the row rather than sending a blank
 * email. It happens for exactly two reasons: a kind that was queued by a newer
 * deploy than the one draining, and a payload with no title.
 */
function renderRow(kind: string, payload: unknown, address: string): EmailBody | null {
  // The no-login "stop all email" link for this exact address, minted here
  // because the drain is the first place that knows who a row is going to. If
  // signing is impossible (SESSION_SECRET unset), fall back to no link rather
  // than throw and halt the whole batch: the preferences link still ships.
  let unsub: string | undefined
  try {
    unsub = unsubscribeUrl(address, signUnsubscribe(address))
  } catch {
    unsub = undefined
  }

  // The yearly offseason renewal ask. Queued, retried, parked and counted like
  // every other row in this table; it only renders somewhere else because it
  // is a question rather than a moderation outcome. See
  // ./season-renewal-email.ts.
  if (kind === SEASON_RENEWAL_EMAIL_KIND) {
    return isSeasonRenewalPayload(payload)
      ? renderSeasonRenewalEmail(payload, preferencesUrl(), unsub)
      : null
  }

  if (!isApprovalEmailKind(kind)) return null
  if (!payload || typeof payload !== 'object') return null
  const p = payload as ApprovalEmailPayload
  if (typeof p.title !== 'string' || !p.title.trim()) return null
  return renderApprovalEmail({ ...p, kind, preferencesUrl: preferencesUrl(), unsubscribeUrl: unsub })
}

// #endregion

// #region drain

export interface NotificationDrainStats {
  /** Rows selected as due this pass. */
  considered: number
  sent: number
  /**
   * Not sent because the reader chose not to hear it: the address is globally
   * unsubscribed, or the user muted this email's category. A terminal, non-error
   * outcome, so it is counted apart from both `sent` and `parked`.
   */
  suppressed: number
  /** Push rows held because push delivery is not built yet. */
  pushHeld: number
  /** Deferred: the user has no verified address yet. Retried later. */
  deferredNoAddress: number
  /** Retryable failure (network, 429, 5xx). Attempts incremented, backed off. */
  retryable: number
  /** Parked: will not be retried. Sum of the parkedBy reasons below. */
  parked: number
  parkedBy: {
    /** Attempt cap reached. */
    attempts: number
    /** Resend refused the recipient because the sender is unverified. */
    sandbox: number
    /** No verified address after the grace window. */
    noAddress: number
    /** No template for the kind, or an unusable payload. */
    unrenderable: number
    /** A permanent transport error, e.g. a bad API key or a rejected body. */
    transport: number
  }
  /** Rows already sitting parked before this pass. Reported, never hidden. */
  alreadyParked: number
}

function emptyStats(): NotificationDrainStats {
  return {
    considered: 0,
    sent: 0,
    suppressed: 0,
    pushHeld: 0,
    deferredNoAddress: 0,
    retryable: 0,
    parked: 0,
    parkedBy: { attempts: 0, sandbox: 0, noAddress: 0, unrenderable: 0, transport: 0 },
    alreadyParked: 0,
  }
}

export interface NotificationDrainOptions {
  /** Most rows to handle in one pass. Defaults to 200. */
  limit?: number
  now?: Date
}

/**
 * Drain the outbox.
 *
 * One pass over the rows whose sendAfter has come and gone, oldest first.
 * Never throws for a single bad row: a thrown exception halfway through a batch
 * would leave the rest untouched with nothing written down about why, which is
 * the failure mode the outbox exists to prevent.
 */
export async function processNotificationDrainJob(
  opts: NotificationDrainOptions = {},
): Promise<NotificationDrainStats> {
  const db = getDb()
  const now = opts.now ?? new Date()
  const limit = opts.limit ?? DEFAULT_DRAIN_LIMIT
  const stats = emptyStats()

  const due = await db
    .select()
    .from(notificationOutbox)
    .where(
      and(
        isNull(notificationOutbox.sentAt),
        lte(notificationOutbox.sendAfter, now),
        lt(notificationOutbox.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(asc(notificationOutbox.sendAfter))
    .limit(limit)

  stats.considered = due.length

  // Count what is already parked before doing anything else. A parked row is
  // somebody who never heard back, and that number has to be visible somewhere
  // other than a SELECT an admin remembers to run.
  const [parkedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notificationOutbox)
    .where(and(isNull(notificationOutbox.sentAt), sql`${notificationOutbox.attempts} >= ${MAX_ATTEMPTS}`))
  stats.alreadyParked = parkedRow?.n ?? 0

  /** One resolved address per user per pass, not per row. */
  const addressCache = new Map<string, string | null>()

  /** One set of muted categories per user per pass, not per row. */
  const mutedCache = new Map<string, Set<string>>()

  /** Recipients refused by the sandbox this pass, named once in the summary. */
  const sandboxRefused = new Set<string>()

  /** Park a row: stop retrying, keep the reason on it. */
  const park = async (id: string, attempts: number, reason: string) => {
    await db
      .update(notificationOutbox)
      .set({ attempts: Math.max(MAX_ATTEMPTS, attempts), error: reason })
      .where(eq(notificationOutbox.id, id))
    stats.parked++
  }

  /**
   * Resolve a row the reader asked not to get. Not a failure and not a park: the
   * row leaves the queue with the reason written on it and is counted as
   * suppressed. sentAt is stamped so the SELECT never picks it up again, and the
   * non-null error beside it is how the audit tells a suppressed row from a
   * delivered one, which clears its error on success.
   */
  const resolveSuppressed = async (id: string, reason: string) => {
    await db.update(notificationOutbox).set({ sentAt: new Date(), error: reason }).where(eq(notificationOutbox.id, id))
    stats.suppressed++
  }

  for (const row of due) {
    // Push is queued but held: there is no push sender yet. Holding without
    // touching `attempts` means these go out on the day one is wired in rather
    // than ageing out in the meantime.
    if (row.channel === 'push') {
      stats.pushHeld++
      continue
    }

    if (row.channel !== 'email') {
      await park(row.id, row.attempts, `unknown channel '${row.channel}'`)
      stats.parkedBy.transport++
      continue
    }

    // Two kinds of recipient. Almost every row is about a signed-in user and
    // its address is resolved from their account (a confirmed channel, or a
    // provider-verified sign-in address, never anything else). The exception is
    // a row with no user and a raw recipientEmail: outreach to a scraped public
    // contact, where the address IS the recipient and there is no account to
    // resolve. That address is always "available", so it skips the grace/defer
    // path a missing user address takes. canDeliverTo() still gates it below.
    let address: string | null
    if (row.userId) {
      const cached = addressCache.get(row.userId)
      if (cached === undefined) {
        address = await resolveEmailRecipient(row.userId)
        addressCache.set(row.userId, address)
      } else {
        address = cached
      }
    } else {
      address = row.recipientEmail?.trim() || null
      if (!address) {
        // A userless row with no address on it either is unrenderable in the
        // one way that never fixes itself. Park it rather than defer forever.
        await park(row.id, row.attempts, 'row has neither a user nor a recipient address')
        stats.parkedBy.noAddress++
        continue
      }
    }

    if (!address) {
      const age = now.getTime() - row.createdAt.getTime()
      if (age > UNDELIVERABLE_GRACE_MS) {
        await park(row.id, row.attempts, 'no verified email address after 14 days')
        stats.parkedBy.noAddress++
      } else {
        // Not a failure, just nowhere to send yet. Push the row forward without
        // spending an attempt, so confirming an address later still delivers it.
        await db
          .update(notificationOutbox)
          .set({
            sendAfter: new Date(now.getTime() + NO_CHANNEL_RETRY_MS),
            error: 'waiting for a verified email address',
          })
          .where(eq(notificationOutbox.id, row.id))
        stats.deferredNoAddress++
      }
      continue
    }

    // Honor the reader's choices before spending anything. The universal
    // unsubscribe wins over everything and reaches accountless outreach too,
    // because it is keyed on the address. The per-category mute only applies to
    // a row that belongs to a signed-in user; outreach has no user and no
    // category, so only the global suppression can stop it.
    if (await isEmailSuppressed(address)) {
      await resolveSuppressed(row.id, 'not sent: recipient has unsubscribed from all email')
      continue
    }
    const category = emailCategoryForKind(row.kind)
    if (row.userId && category) {
      let muted = mutedCache.get(row.userId)
      if (muted === undefined) {
        muted = await getMutedCategories(row.userId)
        mutedCache.set(row.userId, muted)
      }
      if (muted.has(category)) {
        await resolveSuppressed(row.id, `not sent: recipient turned off '${category}' emails`)
        continue
      }
    }

    // Ask before spending an attempt. While RESEND_FROM is an unverified
    // sender, anyone other than the account owner is refused, and there is no
    // point discovering that once per attempt per recipient.
    if (!canDeliverTo(address)) {
      sandboxRefused.add(address)
      await park(row.id, row.attempts, sandboxRefusalReason(address))
      stats.parkedBy.sandbox++
      continue
    }

    const body = renderRow(row.kind, row.payload, address)
    if (!body) {
      await park(row.id, row.attempts, `no email body for kind '${row.kind}'`)
      stats.parkedBy.unrenderable++
      continue
    }

    const result = await sendEmail({
      to: address,
      subject: body.subject,
      html: body.html,
      text: body.text,
      replyTo: REPLY_TO,
    })

    if (result.ok) {
      await db
        .update(notificationOutbox)
        .set({ sentAt: new Date(), attempts: row.attempts + 1, error: null })
        .where(eq(notificationOutbox.id, row.id))
      stats.sent++
      continue
    }

    const attempts = row.attempts + 1

    if (!result.retryable) {
      await park(row.id, attempts, result.error)
      stats.parkedBy.transport++
      continue
    }

    if (attempts >= MAX_ATTEMPTS) {
      await park(row.id, attempts, `gave up after ${attempts} attempts: ${result.error}`)
      stats.parkedBy.attempts++
      continue
    }

    const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempts - 1))
    await db
      .update(notificationOutbox)
      .set({ attempts, error: result.error, sendAfter: new Date(now.getTime() + backoff) })
      .where(eq(notificationOutbox.id, row.id))
    stats.retryable++
  }

  if (sandboxRefused.size > 0) {
    console.warn(
      `[notify] ${stats.parkedBy.sandbox} notification(s) parked for ${sandboxRefused.size} recipient(s) ` +
        `the current Resend sender cannot reach: ${[...sandboxRefused].join(', ')}`,
    )
  }
  if (stats.alreadyParked > 0) {
    console.warn(`[notify] ${stats.alreadyParked} notification(s) are parked unsent and need a look`)
  }

  if (stats.considered > 0 || stats.alreadyParked > 0) {
    console.log(
      `[notify] drained ${stats.considered}: sent=${stats.sent} suppressed=${stats.suppressed} ` +
        `retry=${stats.retryable} parked=${stats.parked} pushHeld=${stats.pushHeld} noAddress=${stats.deferredNoAddress}`,
    )
  }

  return stats
}

// #endregion
