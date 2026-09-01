import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/session'
import { grantWatches, grants, grantFunders, notificationChannels, users } from '@the-tool-pit/db'
import { renderVerifyEmail } from '@/lib/email/templates'
import { MeShell } from '@/components/me/me-shell'
import { GRANTS_ORIGIN } from '@/components/me/vertical-links'

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/**
 * Notification preferences.
 *
 * Everything on this page is a plain form posting to a server action, with no
 * client component anywhere. That is deliberate: these are settings, not an
 * interactive surface, and a settings page that needs JavaScript to change a
 * setting is a settings page that fails in a workshop on bad wifi. Feedback
 * comes back through a ?msg= parameter after a redirect, which is the
 * post/redirect/get pattern and also stops a refresh resubmitting a form.
 */

// #region policy

/** How long an email confirmation link stays good. */
const VERIFY_TTL_HOURS = 24

/** Addresses one account may register. Enough for a mentor plus a team inbox. */
const MAX_EMAIL_CHANNELS = 3

/**
 * Offsets offered in the reminder picker, in days before the deadline.
 * grant_watches.remindDaysBefore can hold anything, this is just the set worth
 * a checkbox.
 */
const OFFSET_CHOICES = [60, 30, 14, 7, 3, 1]

/** Not a validator, a typo catcher. Real validation is the confirmation email. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// #endregion

// #region feedback messages

/**
 * Every outcome a form can produce, keyed so the redirect carries a code rather
 * than a sentence in the URL. `tone` drives the colour and the aria-live role.
 */
const MESSAGES: Record<string, { tone: 'ok' | 'warn' | 'error'; text: string }> = {
  sent: {
    tone: 'ok',
    text: 'Confirmation email sent. Open it and press the button to finish, then reminders can be delivered here.',
  },
  'sent-failed': {
    tone: 'error',
    text: 'The address is saved but the confirmation email could not be sent. Nothing will be delivered to it until it is confirmed. Try again shortly.',
  },
  'sent-sandbox': {
    tone: 'warn',
    text: 'The address is saved, but this site cannot email it yet: the mail sender is still an unverified default that can only reach the site owner. Nothing was sent.',
  },
  confirmed: { tone: 'ok', text: 'Address confirmed. Alerts will be delivered here.' },
  'confirm-bad': {
    tone: 'error',
    text: 'That confirmation link is no longer valid. Send yourself a new one below.',
  },
  removed: { tone: 'ok', text: 'Removed.' },
  saved: { tone: 'ok', text: 'Saved.' },
  unwatched: { tone: 'ok', text: 'Stopped watching that grant. Reminders already queued will still arrive.' },
  'bad-email': { tone: 'error', text: 'That does not look like an email address.' },
  'too-many': {
    tone: 'error',
    text: `You can register up to ${MAX_EMAIL_CHANNELS} addresses. Remove one first.`,
  },
  'no-offsets': { tone: 'error', text: 'Pick at least one reminder, or stop watching the grant.' },
  expired: { tone: 'error', text: 'Your session expired. Sign in again and retry.' },
}

// #endregion

// #region verification tokens

/**
 * Tokens are stored hashed, never in plaintext.
 *
 * The column holds a SHA-256 of the token and the email holds the token itself,
 * so a database dump does not hand anyone the ability to confirm addresses they
 * do not control. SHA-256 rather than a password hash is right here: the token
 * is 32 random bytes, so there is no dictionary to run against it.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Constant-time compare of two hex digests, so a match cannot be timed out. */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

// #endregion

// #region mail transport

/**
 * Send the one email this app sends directly.
 *
 * Alerts go through the worker's outbox; a confirmation link does not, because
 * it is worthless if it arrives on the next drain tick rather than now, and
 * because an unconfirmed address must never be written into the alert table.
 *
 * MIRRORS apps/worker/src/grants/mailer.ts, which is canonical. The sandbox
 * rule is the same one, verified against the live account: while RESEND_FROM is
 * still Resend's shared default sender (onboarding@resend.dev), the API only
 * delivers to the account owner's own address and refuses everyone else with a
 * 403. RESEND_SANDBOX_OWNER names that one address. All of this disappears the
 * moment a real domain is verified and RESEND_FROM points at it. Until then the
 * page says plainly that nothing was sent rather than showing a green tick over
 * an email that never left.
 */
function bareAddress(value: string): string {
  const angled = value.match(/<([^>]+)>/)
  return (angled ? angled[1] : value).trim().toLowerCase()
}

function senderAddress(): string {
  return process.env.RESEND_FROM?.trim() || 'onboarding@resend.dev'
}

function canDeliverTo(address: string): boolean {
  const domain = bareAddress(senderAddress()).split('@')[1] ?? ''
  if (domain !== 'resend.dev') return true
  const owner = process.env.RESEND_SANDBOX_OWNER?.trim()
  // No owner configured means we cannot tell which single address would work,
  // so do not guess and do not spend the request.
  if (!owner) return false
  return bareAddress(address) === bareAddress(owner)
}

type MailOutcome = 'sent' | 'sent-failed' | 'sent-sandbox'

async function sendVerification(to: string, subject: string, html: string, text: string): Promise<MailOutcome> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[notifications] RESEND_API_KEY is not set, no confirmation email sent')
    return 'sent-failed'
  }
  if (!canDeliverTo(to)) {
    console.warn(
      `[notifications] not emailing ${bareAddress(to)}: RESEND_FROM (${senderAddress()}) is an unverified ` +
        'default sender and can only reach the account owner. Verify a domain in Resend and set RESEND_FROM.',
    )
    return 'sent-sandbox'
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: senderAddress(), to: [to], subject, html, text }),
    })
    if (res.ok) return 'sent'
    const body = await res.text().catch(() => '')
    console.warn(`[notifications] resend ${res.status} for ${bareAddress(to)}: ${body.slice(0, 300)}`)
    return 'sent-failed'
  } catch (err) {
    console.warn(`[notifications] resend request failed: ${(err as Error).message}`)
    return 'sent-failed'
  }
}

// #endregion

// #region actions

function done(code: string): never {
  revalidatePath('/me/notifications')
  redirect(`/me/notifications?msg=${code}`)
}

/** Register an address and email it a confirmation link. */
async function addEmailAddress(formData: FormData): Promise<void> {
  'use server'
  const user = await getCurrentUser()
  if (!user) done('expired')

  const address = String(formData.get('address') ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(address) || address.length > 254) done('bad-email')

  const db = getDb()
  const existing = await db
    .select({ id: notificationChannels.id, address: notificationChannels.address })
    .from(notificationChannels)
    .where(and(eq(notificationChannels.userId, user.id), eq(notificationChannels.kind, 'email')))

  if (existing.length >= MAX_EMAIL_CHANNELS && !existing.some((c) => c.address === address)) {
    done('too-many')
  }

  const token = newToken()
  const expiresAt = new Date(Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000)

  // Re-adding an address that is already registered issues a fresh link rather
  // than erroring, because "resend the email" is the common reason to use this
  // form twice. `verified` is deliberately not reset: an address already
  // confirmed stays confirmed, so a stray submit cannot switch someone's alerts
  // off without them noticing.
  await db
    .insert(notificationChannels)
    .values({
      userId: user.id,
      kind: 'email',
      address,
      verifyTokenHash: hashToken(token),
      verifyExpiresAt: expiresAt,
    })
    .onConflictDoUpdate({
      target: [notificationChannels.userId, notificationChannels.kind, notificationChannels.address],
      set: { verifyTokenHash: hashToken(token), verifyExpiresAt: expiresAt, disabledAt: null },
    })

  const base = (process.env.NEXT_PUBLIC_URL ?? 'https://frc.tools').replace(/\/+$/, '')
  const body = renderVerifyEmail({
    verifyUrl: `${base}/me/notifications?verify=${encodeURIComponent(token)}`,
    expiresInHours: VERIFY_TTL_HOURS,
    preferencesUrl: `${base}/me/notifications`,
  })

  done(await sendVerification(address, body.subject, body.html, body.text))
}

/**
 * Finish confirming an address.
 *
 * The link in the email lands on this page with ?verify=, and the page renders
 * a button that posts the token here. It is not confirmed by the GET on
 * purpose: link scanners in corporate mail systems fetch every URL in a message
 * before the human sees it, and a one-click token consumed by a scanner would
 * leave the person with a link that reports itself as already used.
 */
async function confirmEmailAddress(formData: FormData): Promise<void> {
  'use server'
  const user = await getCurrentUser()
  if (!user) done('expired')

  const token = String(formData.get('token') ?? '')
  if (!token) done('confirm-bad')

  const db = getDb()
  const candidates = await db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.userId, user.id), eq(notificationChannels.kind, 'email')))

  const digest = hashToken(token)
  const now = new Date()
  const match = candidates.find(
    (c) =>
      c.verifyTokenHash != null &&
      digestsMatch(c.verifyTokenHash, digest) &&
      c.verifyExpiresAt != null &&
      c.verifyExpiresAt.getTime() > now.getTime(),
  )
  if (!match) done('confirm-bad')

  // Token cleared on use, so a link that leaks later is inert.
  await db
    .update(notificationChannels)
    .set({ verified: true, verifyTokenHash: null, verifyExpiresAt: null, failureCount: 0, disabledAt: null })
    .where(eq(notificationChannels.id, match.id))

  done('confirmed')
}

/** Delete one channel. Scoped to the owner, so an id from elsewhere does nothing. */
async function removeChannel(formData: FormData): Promise<void> {
  'use server'
  const user = await getCurrentUser()
  if (!user) done('expired')

  const id = String(formData.get('channelId') ?? '')
  if (!id) done('confirm-bad')

  const db = getDb()
  await db
    .delete(notificationChannels)
    .where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, user.id)))

  done('removed')
}

/**
 * Turn one channel on or off without deleting it.
 *
 * Disabling keeps the address and its confirmation, so switching alerts back on
 * later does not mean confirming the address again. The drain skips a channel
 * with disabledAt set.
 */
async function setChannelEnabled(formData: FormData): Promise<void> {
  'use server'
  const user = await getCurrentUser()
  if (!user) done('expired')

  const id = String(formData.get('channelId') ?? '')
  const enable = String(formData.get('enable') ?? '') === 'true'
  if (!id) done('confirm-bad')

  const db = getDb()
  await db
    .update(notificationChannels)
    .set({ disabledAt: enable ? null : new Date() })
    .where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, user.id)))

  done('saved')
}

/**
 * Apply one set of reminder offsets to every grant this user watches.
 *
 * The offsets live per watch in the schema, because a team might want a longer
 * run-up on a grant with a heavy application. Nothing exposes that yet, so this
 * page offers the simple version: one timing, applied across the board. When a
 * per-grant control arrives it writes the same column and this form becomes
 * "apply to all".
 */
async function setReminderOffsets(formData: FormData): Promise<void> {
  'use server'
  const user = await getCurrentUser()
  if (!user) done('expired')

  const days = formData
    .getAll('days')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d > 0 && d <= 365)
    .sort((a, b) => b - a)

  if (days.length === 0) done('no-offsets')

  const db = getDb()
  await db
    .update(grantWatches)
    .set({ remindDaysBefore: [...new Set(days)] })
    .where(eq(grantWatches.userId, user.id))

  done('saved')
}

/** Stop watching one grant. Queued reminders are left alone, see the API route. */
async function unwatchGrant(formData: FormData): Promise<void> {
  'use server'
  const user = await getCurrentUser()
  if (!user) done('expired')

  const grantId = String(formData.get('grantId') ?? '')
  if (!grantId) done('confirm-bad')

  const db = getDb()
  await db
    .delete(grantWatches)
    .where(and(eq(grantWatches.userId, user.id), eq(grantWatches.grantId, grantId)))

  done('unwatched')
}

// #endregion

// #region page

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; verify?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const { msg, verify } = await searchParams
  const db = getDb()

  const [channels, watches, account] = await Promise.all([
    db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.userId, user.id))
      .orderBy(asc(notificationChannels.kind), asc(notificationChannels.createdAt)),
    db
      .select({
        grantId: grantWatches.grantId,
        remindDaysBefore: grantWatches.remindDaysBefore,
        notifyOnChange: grantWatches.notifyOnChange,
        createdAt: grantWatches.createdAt,
        name: grants.name,
        slug: grants.slug,
        status: grants.status,
        funderName: grantFunders.name,
      })
      .from(grantWatches)
      .innerJoin(grants, eq(grants.id, grantWatches.grantId))
      .leftJoin(grantFunders, eq(grantFunders.id, grants.funderId))
      .where(eq(grantWatches.userId, user.id))
      .orderBy(desc(grantWatches.createdAt)),
    db
      .select({ email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1),
  ])

  const emailChannels = channels.filter((c) => c.kind === 'email')
  const pushChannels = channels.filter((c) => c.kind === 'push')

  // The sign-in address is a real delivery target when the identity provider
  // says it is verified, and the drain falls back to it. Say so here, otherwise
  // someone with no channel row assumes nothing will ever reach them.
  const signInEmail = account[0]?.emailVerified ? account[0].email : null
  const hasDeliverableEmail =
    emailChannels.some((c) => c.verified && !c.disabledAt) || Boolean(signInEmail)

  // Current offsets, read off the first watch. They are all the same until a
  // per-grant control exists, and the default is what a new watch would get.
  const currentOffsets = watches[0]?.remindDaysBefore ?? [30, 14, 3]

  const banner = msg ? MESSAGES[msg] : undefined

  return (
    <MeShell
      title="Notifications"
      intro="Where grant alerts go, and how much warning you get before a deadline. We only ever remind you on a date the funder published, never on one we worked out ourselves."
      active="notifications"
    >
      {banner && (
        <p
          role={banner.tone === 'ok' ? 'status' : 'alert'}
          className={
            banner.tone === 'ok'
              ? 'mb-8 rounded-lg border border-border-subtle bg-surface p-4 text-sm text-foreground'
              : 'mb-8 rounded-lg border border-border-subtle bg-surface p-4 text-sm text-frc'
          }
        >
          {banner.text}
        </p>
      )}

      {/* The ?verify= landing. Rendered above everything else, because
          somebody who just clicked a link in an email is here to finish
          one thing. */}
      {verify && (
        <section className="mb-10 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 className="text-lg font-semibold text-foreground">Confirm this address</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Press the button to finish confirming the address you clicked through from. Nothing is sent
            to an address until this is done.
          </p>
          <form action={confirmEmailAddress} className="mt-4">
            <input type="hidden" name="token" value={verify} />
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            >
              Confirm this address
            </button>
          </form>
        </section>
      )}

      <div className="flex flex-col gap-14">
        {/* #region email */}
        <section>
          <h2 className="text-lg font-semibold text-foreground">Email</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Add an address and confirm it from the email we send. We confirm first so nobody can point
            alerts at an inbox they do not own.
          </p>

          {signInEmail && (
            <p className="mt-4 rounded-lg border border-border-subtle bg-surface p-4 text-sm text-muted">
              Your sign-in address <span className="text-foreground">{signInEmail}</span> is already
              confirmed by your sign-in provider, so alerts go there unless you add another address
              below.
            </p>
          )}

          {emailChannels.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {emailChannels.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4"
                >
                  <span className="text-sm text-foreground">{c.address}</span>
                  <span className="text-xs text-muted-2">
                    {!c.verified
                      ? 'Not confirmed yet, nothing is sent here'
                      : c.disabledAt
                        ? 'Confirmed, alerts paused'
                        : 'Confirmed'}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    {c.verified && (
                      <form action={setChannelEnabled}>
                        <input type="hidden" name="channelId" value={c.id} />
                        <input type="hidden" name="enable" value={c.disabledAt ? 'true' : 'false'} />
                        <button
                          type="submit"
                          className="rounded-md border border-border-subtle px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
                        >
                          {c.disabledAt ? 'Resume alerts' : 'Pause alerts'}
                        </button>
                      </form>
                    )}
                    <form action={removeChannel}>
                      <input type="hidden" name="channelId" value={c.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-border-subtle px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form
            action={addEmailAddress}
            className="mt-4 flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4 sm:flex-row sm:items-end"
          >
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted">Email address</span>
              <input
                name="address"
                type="email"
                required
                autoComplete="email"
                placeholder="mentor@example.org"
                className="input"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            >
              Send confirmation
            </button>
          </form>

          {!hasDeliverableEmail && (
            <p className="mt-3 text-sm text-frc">
              There is no confirmed address on this account, so grant alerts have nowhere to go. They
              are held rather than thrown away, and they will be delivered once you confirm one.
            </p>
          )}
        </section>
        {/* #endregion */}

        {/* #region push */}
        <section>
          <h2 className="text-lg font-semibold text-foreground">Push</h2>
          {/* Said plainly rather than shown as a toggle that does nothing.
              A switch that silently delivers no notifications is worse than
              no switch. */}
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Browser push is not built yet. You can register a device once it is, and any alert queued
            for push in the meantime is held rather than dropped. Email is the working channel today.
          </p>

          {pushChannels.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {pushChannels.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4"
                >
                  <span className="text-sm text-foreground">
                    {c.pushKeys?.userAgent ?? 'Registered device'}
                  </span>
                  <span className="text-xs text-muted-2">
                    {c.disabledAt ? 'Paused' : 'On, once push delivery ships'}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <form action={setChannelEnabled}>
                      <input type="hidden" name="channelId" value={c.id} />
                      <input type="hidden" name="enable" value={c.disabledAt ? 'true' : 'false'} />
                      <button
                        type="submit"
                        className="rounded-md border border-border-subtle px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
                      >
                        {c.disabledAt ? 'Enable' : 'Disable'}
                      </button>
                    </form>
                    <form action={removeChannel}>
                      <input type="hidden" name="channelId" value={c.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-border-subtle px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        {/* #endregion */}

        {/* #region reminder timing */}
        <section>
          <h2 className="text-lg font-semibold text-foreground">Deadline reminders</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            How far ahead of a closing date to remind you. You get one email per stage, not one per day,
            and only on a deadline the funder has published.
          </p>

          <form
            action={setReminderOffsets}
            className="mt-4 flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4"
          >
            <div className="flex flex-wrap gap-4">
              {OFFSET_CHOICES.map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    name="days"
                    value={d}
                    defaultChecked={currentOffsets.includes(d)}
                    className="h-4 w-4"
                  />
                  {d === 1 ? '1 day before' : `${d} days before`}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={watches.length === 0}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
              >
                Save timing
              </button>
              <span className="text-xs text-muted-2">
                {watches.length === 0
                  ? 'Applies once you are watching a grant.'
                  : `Applies to all ${watches.length} grant${watches.length === 1 ? '' : 's'} you watch.`}
              </span>
            </div>
          </form>
        </section>
        {/* #endregion */}

        {/* #region watched grants */}
        <section>
          <h2 className="text-lg font-semibold text-foreground">
            Grants you watch
            {watches.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-2">{watches.length}</span>
            )}
          </h2>

          {watches.length === 0 ? (
            <p className="mt-4 rounded-lg border border-border-subtle bg-surface p-4 text-sm text-muted">
              You are not watching any grants yet. Open a listing and press Watch, and you will hear
              before the deadline instead of after it.{' '}
              <Link href={GRANTS_ORIGIN} className="text-primary hover:underline">
                Browse grants
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {watches.map((w) => (
                <li
                  key={w.grantId}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4"
                >
                  <div className="min-w-0">
                    <Link
                      href={`${GRANTS_ORIGIN}/${w.slug}`}
                      className="text-sm font-medium text-foreground hover:underline"
                    >
                      {w.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-2">
                      {w.funderName ? `${w.funderName} · ` : ''}
                      {w.remindDaysBefore.length > 0
                        ? `Reminders ${w.remindDaysBefore.join(', ')} days before`
                        : 'No reminders set'}
                      {/* A watch on a listing that has been pulled back for
                          review gets no reminders at all. Say so on the row
                          rather than letting it look active. */}
                      {w.status !== 'published' && ' · listing under review, reminders paused'}
                    </p>
                  </div>
                  <form action={unwatchGrant} className="ml-auto">
                    <input type="hidden" name="grantId" value={w.grantId} />
                    <button
                      type="submit"
                      className="rounded-md border border-border-subtle px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
                    >
                      Stop watching
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
        {/* #endregion */}
      </div>
    </MeShell>
  )
}

// #endregion
