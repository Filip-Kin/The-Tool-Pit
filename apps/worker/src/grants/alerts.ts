/**
 * Grant alert outbox: write side and drain side.
 *
 * Everything that wants to tell a team something goes through here. Nothing
 * calls the mail transport directly. The reasons are the ones the schema
 * comment on grant_alerts already gives, and one more:
 *
 *   - IDEMPOTENCY. Every alert carries a dedupeKey and the table has a unique
 *     index on it, so enqueueing is ON CONFLICT DO NOTHING. Two sweeper passes
 *     on the same day, a retried BullMQ job, or a scheduler that fires twice
 *     after a restart all collapse to one row and therefore one email.
 *   - AUDIT. A row survives a broken provider. "Did we tell them?" is a SELECT,
 *     not a guess at a log file.
 *   - HONEST FAILURE. An alert that cannot be delivered is parked with the
 *     reason written on the row, and every park is counted in the drain stats.
 *     A recipient we silently never mail is exactly the kind of quiet cap this
 *     product does not allow.
 *
 * WHY THE EMAIL BODIES ARE DUPLICATED HERE
 * apps/web/lib/email/templates.ts is the canonical copy and this is a mirror of
 * it. The worker's tsconfig sets `rootDir: ./src`, so tsc rejects any import
 * that reaches outside apps/worker/src (TS6059), and the templates cannot be
 * imported across the app boundary. The proper fix is to lift the module into
 * packages/types, which both apps already depend on. Until that happens the two
 * copies change in the same commit. Nothing else in this file is duplicated.
 */
import { and, asc, eq, isNull, lt, lte, sql } from 'drizzle-orm'
import {
  getDb,
  grantAlerts,
  notificationChannels,
  users,
  type AlertChannel,
  type AlertKind,
} from '@the-tool-pit/db'
import { canDeliverTo, sandboxRefusalReason, sendEmail } from './mailer.js'

// #region policy

/**
 * How many delivery attempts one alert gets before it is parked.
 *
 * Parked means "stop trying", not "deleted": the row keeps its error text and
 * an admin can requeue it by resetting `attempts`. There is no `failed` column
 * on grant_alerts, so parking is expressed as attempts stamped at the cap,
 * which is also what keeps the row out of the next drain's SELECT.
 */
export const MAX_ATTEMPTS = 5

/** First retry gap. Doubles per attempt up to RETRY_MAX_MS. */
const RETRY_BASE_MS = 10 * 60 * 1000

/** Longest gap between retries. Beyond this, waiting longer helps nobody. */
const RETRY_MAX_MS = 6 * 60 * 60 * 1000

/**
 * How long an alert waits for a deliverable address before it is given up on.
 *
 * A user with no verified email is not a failure, they just have not confirmed
 * an address yet, so the alert is deferred rather than burned. But a deferral
 * with no end is a hole: the row would sit unsent forever and never appear in
 * any count that matters. After this it is parked with the reason on the row.
 */
const UNDELIVERABLE_GRACE_MS = 30 * 24 * 60 * 60 * 1000

/** How long to wait before re-checking whether a user has verified an address. */
const NO_CHANNEL_RETRY_MS = 12 * 60 * 60 * 1000

/** Most alerts one drain pass will handle. Anything left over goes next pass. */
const DEFAULT_DRAIN_LIMIT = 200

// #endregion

// #region payloads

/**
 * The facts an alert needs, captured when it is queued.
 *
 * These are plain object types rather than interfaces on purpose: the column is
 * jsonb typed as Record<string, unknown>, and TypeScript only gives implicit
 * index signatures to type aliases, not to interfaces.
 *
 * Dates are ISO strings because that is what jsonb hands back. Parse on read.
 *
 * The payload is deliberately self-contained. The drain never re-joins to
 * grants or grant_cycles at send time, so a listing edited between queueing and
 * sending cannot quietly rewrite a reminder that was already promised, and a
 * deleted grant cannot make a queued alert unrenderable. A listing that changed
 * in a way the team should know about produces its own grant_change alert.
 */
export type NewMatchAlertPayload = {
  grantName: string
  grantUrl: string
  funderName?: string | null
  /** e.g. "Team 3538". Absent when the alert is not team-scoped. */
  teamLabel?: string | null
  /** 'eligible' or 'likely'. Nothing weaker is ever emailed. */
  verdict: string
  awardMin?: number | null
  awardMax?: number | null
  awardCurrency?: string | null
  /** ISO 8601, or absent when the cycle has no published deadline. */
  deadlineAt?: string | null
  deadlineNote?: string | null
  /** Requirement labels the team passes, so the match explains itself. */
  passedReasons?: string[]
  /** Requirement labels we could not test, named rather than hidden. */
  unknownReasons?: string[]
}

export type DeadlineAlertPayload = {
  grantName: string
  grantUrl: string
  funderName?: string | null
  /** ISO 8601. Required: a deadline alert without a deadline is not an alert. */
  deadlineAt: string
  deadlineNote?: string | null
  applicationUrl?: string | null
  /** ISO 8601 of the human confirmation of these dates, when there is one. */
  verifiedAt?: string | null
  /** The reminder offset that produced this row, for the log and the admin. */
  daysBefore: number
}

export type GrantChangeAlertPayload = {
  grantName: string
  grantUrl: string
  /** Short human phrases, e.g. "Award max went from $2,000 to $5,000". */
  changes: string[]
  /** True while a moderator has not confirmed the change yet. */
  awaitingReview?: boolean
}

export type GrantAlertPayload = NewMatchAlertPayload | DeadlineAlertPayload | GrantChangeAlertPayload

// #endregion

// #region enqueue

export interface EnqueueGrantAlertInput {
  userId: string
  kind: AlertKind
  /** Defaults to 'email'. 'push' rows are queued but held, see the drain. */
  channel?: AlertChannel
  grantId?: string | null
  cycleId?: string | null
  /**
   * Idempotency key. Shapes in use:
   *   deadline:<cycleId>:<userId>:<daysBefore>
   *   new_match:<matchId>:<userId>
   *   grant_change:<changeId>:<userId>
   * The key never names the source of the alert, so a user who both watches a
   * grant and matches it gets one reminder rather than two.
   */
  dedupeKey: string
  /** Earliest send time. Defaults to now. */
  sendAfter?: Date
  payload: GrantAlertPayload
}

/**
 * Queue one alert. Returns the new row id, or null when the dedupeKey already
 * existed and nothing was written.
 *
 * The conflict case is the normal case, not an error: the sweeper re-derives
 * every reminder it could send on every pass and lets the unique index decide
 * which are new. That is what makes the sweeper safe to run hourly.
 */
export async function enqueueGrantAlert(input: EnqueueGrantAlertInput): Promise<string | null> {
  const db = getDb()

  const [row] = await db
    .insert(grantAlerts)
    .values({
      userId: input.userId,
      kind: input.kind,
      channel: input.channel ?? 'email',
      grantId: input.grantId ?? null,
      cycleId: input.cycleId ?? null,
      payload: input.payload,
      dedupeKey: input.dedupeKey,
      sendAfter: input.sendAfter ?? new Date(),
    })
    .onConflictDoNothing({ target: grantAlerts.dedupeKey })
    .returning({ id: grantAlerts.id })

  return row?.id ?? null
}

// #endregion

// #region rendering (mirror of apps/web/lib/email/templates.ts)

interface EmailBody {
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
 * it. US Eastern by default because these are almost all US funders quoting US
 * closing times, and `timeZoneName: 'short'` means the reader always sees which
 * zone they are being told.
 */
function formatDeadline(at: Date, timeZone = 'America/New_York'): string {
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
function formatAward(min: number | null, max: number | null, currency = 'USD'): string | null {
  const symbol = currency === 'USD' ? '$' : `${currency} `
  const n = (v: number) => `${symbol}${v.toLocaleString('en-US')}`
  if (min != null && max != null) return min === max ? n(min) : `${n(min)} to ${n(max)}`
  if (max != null) return `up to ${n(max)}`
  if (min != null) return `from ${n(min)}`
  return null
}

interface LayoutInput {
  heading: string
  paragraphs: string[]
  facts?: Array<{ label: string; value: string }>
  cta?: { label: string; url: string }
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

function renderNewMatch(p: NewMatchAlertPayload, preferencesUrl: string): EmailBody {
  const who = p.teamLabel ? `${p.teamLabel} looks` : 'You look'
  const strength = p.verdict === 'eligible' ? 'eligible for' : 'a likely fit for'

  const paragraphs = [`${who} ${strength} ${p.grantName}.`]
  if (p.passedReasons?.length) {
    paragraphs.push(`Why: ${p.passedReasons.slice(0, 4).join('; ')}.`)
  }
  if (p.unknownReasons?.length) {
    paragraphs.push(
      `We could not check ${p.unknownReasons.slice(0, 3).join('; ')}. Fill those in on your team profile and the match gets firmer.`,
    )
  }
  paragraphs.push(
    'Check the funder’s own page before you apply. We match on what we have recorded, and the funder is always the last word.',
  )

  const facts: Array<{ label: string; value: string }> = []
  if (p.funderName) facts.push({ label: 'Funder', value: p.funderName })
  const award = formatAward(p.awardMin ?? null, p.awardMax ?? null, p.awardCurrency ?? 'USD')
  if (award) facts.push({ label: 'Award', value: award })
  const deadline = p.deadlineAt ? new Date(p.deadlineAt) : null
  if (deadline && !Number.isNaN(deadline.getTime())) {
    facts.push({ label: 'Deadline', value: formatDeadline(deadline) })
  }
  if (p.deadlineNote) facts.push({ label: 'Funder’s wording', value: p.deadlineNote })

  const { html, text } = layout({
    heading: `New grant match: ${p.grantName}`,
    paragraphs,
    facts,
    cta: { label: 'Open the listing', url: p.grantUrl },
    reason: 'You are getting this because grant matching is on for your team.',
    preferencesUrl,
  })

  return { subject: `New grant match: ${p.grantName}`, html, text }
}

function renderDeadline(p: DeadlineAlertPayload, preferencesUrl: string, now: Date): EmailBody {
  const at = new Date(p.deadlineAt)
  // Real days remaining at send time, not the offset the row was queued at. A
  // reminder that sat in the outbox for two days must not still say 14 days.
  const daysLeft = Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 86_400_000))
  const days = daysLeft <= 0 ? 'Closes today' : daysLeft === 1 ? '1 day left' : `${daysLeft} days left`

  const paragraphs = [`${days} to apply for ${p.grantName}.`]
  const verified = p.verifiedAt ? new Date(p.verifiedAt) : null
  if (verified && !Number.isNaN(verified.getTime())) {
    paragraphs.push(
      `These dates were last confirmed against the funder’s page on ${formatDeadline(verified).split(',')[1]?.trim() ?? formatDeadline(verified)}.`,
    )
  } else {
    // We only ever remind on a funder-published date, so this branch means the
    // date is published but nobody has re-checked it lately. Say so plainly.
    paragraphs.push('Nobody has re-checked this date recently, so open the funder’s page before you rely on it.')
  }

  const facts: Array<{ label: string; value: string }> = [{ label: 'Deadline', value: formatDeadline(at) }]
  if (p.deadlineNote) facts.push({ label: 'Funder’s wording', value: p.deadlineNote })
  if (p.funderName) facts.push({ label: 'Funder', value: p.funderName })

  const { html, text } = layout({
    heading: `${days}: ${p.grantName}`,
    paragraphs,
    facts,
    cta: {
      label: p.applicationUrl ? 'Start the application' : 'Open the listing',
      url: p.applicationUrl || p.grantUrl,
    },
    reason: 'You are getting this because you are watching this grant.',
    preferencesUrl,
  })

  return { subject: `${days}: ${p.grantName}`, html, text }
}

function renderGrantChange(p: GrantChangeAlertPayload, preferencesUrl: string): EmailBody {
  const paragraphs = [`Something changed on the ${p.grantName} listing.`]
  if (p.awaitingReview) {
    paragraphs.push(
      'This came off the funder’s page automatically and a moderator has not confirmed it yet. Treat it as a heads-up, not as fact.',
    )
  }

  const { html, text } = layout({
    heading: `Listing changed: ${p.grantName}`,
    paragraphs,
    facts: p.changes.slice(0, 8).map((c, i) => ({ label: i === 0 ? 'Changed' : '', value: c })),
    cta: { label: 'Open the listing', url: p.grantUrl },
    reason: 'You are getting this because you are watching this grant.',
    preferencesUrl,
  })

  return { subject: `Listing changed: ${p.grantName}`, html, text }
}

/** Where /me/notifications lives. Same host as the tools directory. */
export function preferencesUrl(): string {
  const base = (process.env.NEXT_PUBLIC_URL ?? 'https://ttp.filipkin.com').replace(/\/+$/, '')
  return `${base}/me/notifications`
}

/**
 * Public URL of one grant listing.
 *
 * One host, path per vertical. There is no grants.* host any more: it still
 * resolves and redirects, but an email should link straight to the final URL
 * rather than send the reader through a 308 on a hostname whose certificate we
 * cannot renew.
 */
export function grantUrl(slug: string): string {
  const base = (process.env.NEXT_PUBLIC_URL ?? 'https://frc.tools').replace(/\/+$/, '')
  return `${base}/grants/${slug}`
}

/**
 * Render one queued alert. Returns null for a kind we have no body for, which
 * the drain reports rather than sending a blank email.
 */
function renderAlert(kind: string, payload: unknown, now: Date): EmailBody | null {
  if (!payload || typeof payload !== 'object') return null
  const prefs = preferencesUrl()
  switch (kind) {
    case 'new_match':
      return renderNewMatch(payload as NewMatchAlertPayload, prefs)
    case 'deadline':
      return renderDeadline(payload as DeadlineAlertPayload, prefs, now)
    case 'grant_change':
    case 'watch_update':
      return renderGrantChange(payload as GrantChangeAlertPayload, prefs)
    default:
      return null
  }
}

// #endregion

// #region recipients

/**
 * Where one user's email should go, or null when we have nowhere to send.
 *
 * Order matters. A verified notification_channels row is an address the person
 * confirmed for this purpose and it wins. Failing that we fall back to the
 * account's own sign-in address, but ONLY when the identity provider says it is
 * verified: users.emailVerified is Firebase's own email_verified claim copied
 * at sign-in, so that address has been proven to belong to them. An unverified
 * address is never mailed, which is what stops a signed-in user pointing grant
 * alerts at somebody else's inbox.
 */
async function resolveEmailRecipient(userId: string): Promise<string | null> {
  const db = getDb()

  const [channel] = await db
    .select({ address: notificationChannels.address })
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.userId, userId),
        eq(notificationChannels.kind, 'email'),
        eq(notificationChannels.verified, true),
        isNull(notificationChannels.disabledAt),
      ),
    )
    .orderBy(asc(notificationChannels.createdAt))
    .limit(1)
  if (channel?.address) return channel.address

  const [user] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (user?.email && user.emailVerified) return user.email

  return null
}

// #endregion

// #region drain

export interface GrantAlertDrainStats {
  /** Rows selected as due this pass. */
  considered: number
  sent: number
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
    /** The deadline had already passed by the time we could send. */
    stale: number
    /** No template for the alert kind, or an unusable payload. */
    unrenderable: number
    /** A permanent transport error, e.g. a bad API key or a rejected body. */
    transport: number
  }
  /** Rows already sitting parked before this pass. Reported, never hidden. */
  alreadyParked: number
}

function emptyStats(): GrantAlertDrainStats {
  return {
    considered: 0,
    sent: 0,
    pushHeld: 0,
    deferredNoAddress: 0,
    retryable: 0,
    parked: 0,
    parkedBy: { attempts: 0, sandbox: 0, noAddress: 0, stale: 0, unrenderable: 0, transport: 0 },
    alreadyParked: 0,
  }
}

export interface GrantAlertDrainOptions {
  /** Most alerts to handle in one pass. Defaults to 200. */
  limit?: number
  now?: Date
}

/**
 * Drain the outbox.
 *
 * One pass over the alerts whose sendAfter has come and gone, oldest first.
 * Never throws for a single bad row: a thrown exception halfway through a batch
 * would leave the rest untouched with nothing written down about why, which is
 * the failure mode the outbox exists to prevent.
 */
export async function processGrantAlertDrainJob(
  opts: GrantAlertDrainOptions = {},
): Promise<GrantAlertDrainStats> {
  const db = getDb()
  const now = opts.now ?? new Date()
  const limit = opts.limit ?? DEFAULT_DRAIN_LIMIT
  const stats = emptyStats()

  const due = await db
    .select()
    .from(grantAlerts)
    .where(
      and(
        isNull(grantAlerts.sentAt),
        lte(grantAlerts.sendAfter, now),
        lt(grantAlerts.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(asc(grantAlerts.sendAfter))
    .limit(limit)

  stats.considered = due.length

  // Count what is already parked before doing anything else. A parked alert is
  // an alert nobody received, and the number has to be visible somewhere other
  // than a SELECT somebody remembers to run.
  const [parkedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(grantAlerts)
    .where(and(isNull(grantAlerts.sentAt), sql`${grantAlerts.attempts} >= ${MAX_ATTEMPTS}`))
  stats.alreadyParked = parkedRow?.n ?? 0

  /** One resolved address per user per pass, not per alert. */
  const addressCache = new Map<string, string | null>()

  /** Recipients refused by the sandbox this pass, named once in the summary. */
  const sandboxRefused = new Set<string>()

  /** Park a row: stop retrying, keep the reason on it. */
  const park = async (id: string, attempts: number, reason: string) => {
    await db
      .update(grantAlerts)
      .set({ attempts: Math.max(MAX_ATTEMPTS, attempts), error: reason })
      .where(eq(grantAlerts.id, id))
    stats.parked++
  }

  for (const alert of due) {
    // Push is a real channel row with a real endpoint waiting for it, it just
    // has no sender yet. Holding the row rather than failing it means these
    // alerts go out on the day the push sidecar is wired in, and holding
    // without touching `attempts` means they cannot age out in the meantime.
    // Reported in the stats, never a silent no-op.
    if (alert.channel === 'push') {
      stats.pushHeld++
      continue
    }

    if (alert.channel !== 'email') {
      await park(alert.id, alert.attempts, `unknown channel '${alert.channel}'`)
      stats.parkedBy.transport++
      continue
    }

    // A deadline reminder that missed its own deadline is worse than no email.
    if (alert.kind === 'deadline') {
      const raw = (alert.payload as DeadlineAlertPayload | null)?.deadlineAt
      const at = raw ? new Date(raw) : null
      if (at && !Number.isNaN(at.getTime()) && at.getTime() < now.getTime()) {
        await park(alert.id, alert.attempts, 'deadline passed before the alert could be delivered')
        stats.parkedBy.stale++
        continue
      }
    }

    let address = addressCache.get(alert.userId)
    if (address === undefined) {
      address = await resolveEmailRecipient(alert.userId)
      addressCache.set(alert.userId, address)
    }

    if (!address) {
      const age = now.getTime() - alert.createdAt.getTime()
      if (age > UNDELIVERABLE_GRACE_MS) {
        await park(alert.id, alert.attempts, 'no verified email address after 30 days')
        stats.parkedBy.noAddress++
      } else {
        // Not a failure, just nowhere to send yet. Push the row forward without
        // spending an attempt, so confirming an address later still delivers it.
        await db
          .update(grantAlerts)
          .set({
            sendAfter: new Date(now.getTime() + NO_CHANNEL_RETRY_MS),
            error: 'waiting for a verified email address',
          })
          .where(eq(grantAlerts.id, alert.id))
        stats.deferredNoAddress++
      }
      continue
    }

    // Ask before spending an attempt. While RESEND_FROM is still the unverified
    // default sender, anyone other than the account owner is refused, and there
    // is no point discovering that once per attempt per recipient.
    if (!canDeliverTo(address)) {
      sandboxRefused.add(address)
      await park(alert.id, alert.attempts, sandboxRefusalReason(address))
      stats.parkedBy.sandbox++
      continue
    }

    const body = renderAlert(alert.kind, alert.payload, now)
    if (!body) {
      await park(alert.id, alert.attempts, `no email body for kind '${alert.kind}'`)
      stats.parkedBy.unrenderable++
      continue
    }

    const result = await sendEmail({
      to: address,
      subject: body.subject,
      html: body.html,
      text: body.text,
    })

    if (result.ok) {
      await db
        .update(grantAlerts)
        .set({ sentAt: new Date(), attempts: alert.attempts + 1, error: null })
        .where(eq(grantAlerts.id, alert.id))
      stats.sent++
      continue
    }

    const attempts = alert.attempts + 1

    if (!result.retryable) {
      await park(alert.id, attempts, result.error)
      stats.parkedBy.transport++
      continue
    }

    if (attempts >= MAX_ATTEMPTS) {
      await park(alert.id, attempts, `gave up after ${attempts} attempts: ${result.error}`)
      stats.parkedBy.attempts++
      continue
    }

    const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempts - 1))
    await db
      .update(grantAlerts)
      .set({ attempts, error: result.error, sendAfter: new Date(now.getTime() + backoff) })
      .where(eq(grantAlerts.id, alert.id))
    stats.retryable++
  }

  if (stats.pushHeld > 0) {
    console.warn(
      `[grant-alerts] holding ${stats.pushHeld} push alert(s): push delivery is not implemented yet. ` +
        'They stay queued and will send once the push sender is wired in.',
    )
  }
  if (sandboxRefused.size > 0) {
    console.warn(
      `[grant-alerts] ${stats.parkedBy.sandbox} alert(s) parked for ${sandboxRefused.size} recipient(s) ` +
        `the current Resend sender cannot reach: ${[...sandboxRefused].join(', ')}`,
    )
  }
  if (stats.alreadyParked > 0) {
    console.warn(
      `[grant-alerts] ${stats.alreadyParked} alert(s) are parked unsent and need a look in the admin`,
    )
  }

  console.log(
    `[grant-alerts] drained ${stats.considered}: sent=${stats.sent} retry=${stats.retryable} ` +
      `parked=${stats.parked} pushHeld=${stats.pushHeld} noAddress=${stats.deferredNoAddress}`,
  )

  return stats
}

// #endregion
