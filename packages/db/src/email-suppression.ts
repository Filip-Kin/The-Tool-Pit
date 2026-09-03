/**
 * The universal unsubscribe: sign a link that needs no login, and the store it
 * writes to.
 *
 * It lives in packages/db rather than in @the-tool-pit/types because it needs
 * two things that package refuses to carry: node crypto (to sign the token) and
 * the drizzle client (to read and write the suppression table). The URL BUILDER
 * stays in @the-tool-pit/types (unsubscribeUrl), which is pure string building;
 * only the signature and the queries are here.
 *
 * WHY A SIGNED TOKEN AND NOT A STORED ONE. The recipient may be a scraped public
 * contact with no account and no row anywhere to pin a token to. So the link
 * carries a signature over the lower-cased address, minted with SESSION_SECRET,
 * and the route re-derives the same signature to check it before it suppresses
 * anything. No token column, no stored secret in the URL, and a database dump
 * hands nobody the ability to unsubscribe an address they do not control. This
 * is the same shape as the outreach remove-link token in apps/web, kept here so
 * both apps (the web /unsubscribe route and the worker drain that mints the
 * link) can reach it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getDb } from './client'
import { emailSuppressions, notificationCategoryMutes } from './schema/notifications'

// #region token

function secret(): string {
  const raw = process.env.SESSION_SECRET
  if (!raw || raw.length < 32) {
    throw new Error('SESSION_SECRET is unset or shorter than 32 characters')
  }
  return raw
}

/** Lower-case and trim, so one inbox has one spelling everywhere. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Sign one address for its unsubscribe link. Stable for a given secret. */
export function signUnsubscribe(email: string): string {
  return createHmac('sha256', secret()).update(`unsubscribe:${normalizeEmail(email)}`).digest('base64url')
}

/** Constant-time check that a token was signed for exactly this address. */
export function verifyUnsubscribe(email: string, token: string | null | undefined): boolean {
  if (!token) return false
  const expected = Buffer.from(signUnsubscribe(email))
  const given = Buffer.from(token)
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}

// #endregion

// #region store

/** The narrow slice of the drizzle client these helpers use. */
type DbLike = ReturnType<typeof getDb>

/** True when this address has unsubscribed from everything. */
export async function isEmailSuppressed(email: string, db: DbLike = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, normalizeEmail(email)))
    .limit(1)
  return Boolean(row)
}

/**
 * Suppress all email to an address. Idempotent: a second unsubscribe is a
 * no-op, not an error, so a re-clicked link or a double submit is harmless.
 */
export async function suppressEmail(
  email: string,
  source = 'unsubscribe_link',
  db: DbLike = getDb(),
): Promise<void> {
  await db
    .insert(emailSuppressions)
    .values({ email: normalizeEmail(email), source })
    .onConflictDoNothing({ target: emailSuppressions.email })
}

/** Lift a suppression, so the address can receive email again. */
export async function unsuppressEmail(email: string, db: DbLike = getDb()): Promise<void> {
  await db.delete(emailSuppressions).where(eq(emailSuppressions.email, normalizeEmail(email)))
}

// #endregion

// #region category mutes

/** The categories this user has switched off. Empty is the normal state. */
export async function getMutedCategories(userId: string, db: DbLike = getDb()): Promise<Set<string>> {
  const rows = await db
    .select({ category: notificationCategoryMutes.category })
    .from(notificationCategoryMutes)
    .where(eq(notificationCategoryMutes.userId, userId))
  return new Set(rows.map((r) => r.category))
}

/** Mute or unmute one category for one user. Both directions are idempotent. */
export async function setCategoryMuted(
  userId: string,
  category: string,
  muted: boolean,
  db: DbLike = getDb(),
): Promise<void> {
  if (muted) {
    await db
      .insert(notificationCategoryMutes)
      .values({ userId, category })
      .onConflictDoNothing({
        target: [notificationCategoryMutes.userId, notificationCategoryMutes.category],
      })
  } else {
    await db
      .delete(notificationCategoryMutes)
      .where(and(eq(notificationCategoryMutes.userId, userId), eq(notificationCategoryMutes.category, category)))
  }
}

// #endregion
