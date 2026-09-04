import { createHmac, timingSafeEqual } from 'crypto'

/**
 * The signed token behind an outreach "Remove this listing" link.
 *
 * WHY A SIGNED TOKEN AND NOT A STORED ONE. The listing_invites table is the
 * site's single-use sha256-token store, but every row there is pinned to an
 * inviting USER (invited_by_user_id is NOT NULL). Outreach has no user: it goes
 * to a scraped public contact who has no account. Reusing that table would mean
 * a migration to make the owner nullable, and adding a token column to
 * event_listings would mean a migration too. Neither is needed. The link only
 * ever performs ONE idempotent, non-escalating action, suppressing a listing,
 * so a stateless signature is enough: we sign the entity with SESSION_SECRET
 * and the route re-derives the same signature to check the link before it
 * suppresses anything. No table, no migration, no stored secret in the URL.
 *
 * This is not literally single-use, but it does not need to be: suppressing an
 * already-suppressed listing is a no-op, and the recipient IS the event's
 * public contact, so a durable "take it down" link in their inbox is correct.
 *
 * It lives in apps/web rather than in @the-tool-pit/types because signing needs
 * node crypto and the secret, and that package is pure string building with no
 * @types/node on purpose. The URL builder (removeListingUrl) stays over there;
 * only the signature is minted and checked here.
 */

function secret(): string {
  const raw = process.env.SESSION_SECRET
  if (!raw || raw.length < 32) {
    throw new Error('SESSION_SECRET is unset or shorter than 32 characters')
  }
  return raw
}

/** Sign one listing for the outreach remove link. Stable for a given secret. */
export function signOutreachRemove(entityType: string, entityId: string): string {
  return createHmac('sha256', secret()).update(`outreach-remove:${entityType}:${entityId}`).digest('base64url')
}

/** Constant-time check that a token was signed for exactly this listing. */
export function verifyOutreachRemove(
  entityType: string,
  entityId: string,
  token: string | null | undefined,
): boolean {
  if (!token) return false
  const expected = Buffer.from(signOutreachRemove(entityType, entityId))
  const given = Buffer.from(token)
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}

/**
 * The signed token behind an outreach "Claim this listing" link.
 *
 * Same stateless HMAC as the remove token, but a SEPARATE namespace so a remove
 * link can never be replayed as a claim. Its presence is what turns a claim from
 * the outreach email into an instant grant: the moderator already vetted the
 * listing when they sent the email to the event's own contact, so a click from
 * that email is the review, not the start of one. The claim page reads it off
 * the URL and hands it to startClaim, which re-derives the signature before
 * granting anything.
 */
export function signOutreachClaim(entityType: string, entityId: string): string {
  return createHmac('sha256', secret()).update(`outreach-claim:${entityType}:${entityId}`).digest('base64url')
}

/** Constant-time check that a claim token was signed for exactly this listing. */
export function verifyOutreachClaim(
  entityType: string,
  entityId: string,
  token: string | null | undefined,
): boolean {
  if (!token) return false
  const expected = Buffer.from(signOutreachClaim(entityType, entityId))
  const given = Buffer.from(token)
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}
