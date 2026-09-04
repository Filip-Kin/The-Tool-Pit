/**
 * Public URLs for links inside emails.
 *
 * ONE HOST, PATH PER VERTICAL. There is no grants.* or fields.* host any more:
 * they still resolve and redirect, but an email should link straight to the
 * final URL rather than send the reader through a 308 on a hostname whose
 * certificate we cannot renew.
 *
 * NEXT_PUBLIC_URL is the canonical origin. It is read at call time rather than
 * captured at module load so a worker restarted with a different value picks
 * it up, and it falls back to production rather than to localhost: a link to
 * localhost in somebody's inbox is worse than a link to the live site.
 */

/**
 * Canonical origin, no trailing slash.
 *
 * Read off globalThis rather than off `process` directly, because this package
 * deliberately carries no @types/node: it is pure string building imported by a
 * Node worker AND by Next server components, and pulling Node's whole type
 * surface in here to read one environment variable is not a trade worth making.
 */
export function siteUrl(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return (env?.NEXT_PUBLIC_URL ?? 'https://frc.tools').replace(/\/+$/, '')
}

/** Where /me/notifications lives. Every email footer points here. */
export function preferencesUrl(): string {
  return `${siteUrl()}/me/notifications`
}

/**
 * The no-login "stop all email to this address" link for a footer.
 *
 * Accountless on purpose: the recipient may be a scraped public contact with no
 * frc.tools account, so this cannot sit behind sign-in. The `token` is a signed
 * value the /unsubscribe route checks before it suppresses anything, so the link
 * is safe to put in an inbox. Pure string building here; the signing and the
 * suppression store live in @the-tool-pit/db, which has the secret and the
 * crypto this package deliberately does not.
 */
export function unsubscribeUrl(email: string, token: string): string {
  return `${siteUrl()}/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`
}

/** Public URL of one grant listing. */
export function grantListingUrl(slug: string): string {
  return `${siteUrl()}/grants/${slug}`
}

/** Public URL of one practice field, keyed by its human slug. */
export function fieldUrl(slug: string): string {
  return `${siteUrl()}/fields/${slug}`
}

/** Public URL of one off-season event listing, keyed by its human slug. */
export function eventListingUrl(slug: string): string {
  return `${siteUrl()}/events/${slug}`
}

/** Public URL of one tool listing. */
export function toolUrl(slug: string): string {
  return `${siteUrl()}/tools/${slug}`
}

/**
 * Public URL of the event page an album hangs off.
 *
 * Albums have no page of their own: they are cards on their event's page, so
 * the link has to be the event, keyed by its TBA key.
 */
export function albumEventUrl(tbaKey: string): string {
  return `${siteUrl()}/photos/event/${tbaKey}`
}

/** Where somebody manages the listings they own. */
export function myListingsUrl(): string {
  return `${siteUrl()}/me/listings`
}

/**
 * The claim flow for one listing, prefilled with what is being claimed.
 *
 * The same `/me/listings/claim?type=&id=` the public "Claim this listing"
 * control points at, built as an absolute URL so it works from an inbox. Claim
 * needs an account, so the page asks the reader to sign in and then carries on
 * to the same claim, which is the correct door for an organiser we emailed:
 * proving they run the event is exactly what a claim is for.
 */
export function claimListingUrl(entityType: string, entityId: string, token?: string): string {
  const base = `${siteUrl()}/me/listings/claim?type=${encodeURIComponent(entityType)}&id=${encodeURIComponent(entityId)}`
  // The signed outreach-claim token, when this link goes in an email WE sent the
  // organiser. It is what makes their click an instant grant instead of a claim
  // in the review queue: the outreach was the review. Absent on the public
  // "Claim this listing" control, which is a cold claim and must be vetted.
  return token ? `${base}&t=${encodeURIComponent(token)}` : base
}

/**
 * The one-click "take this listing down" link for an outreach email.
 *
 * Accountless on purpose: the recipient is the scraped public contact, who has
 * no frc.tools account, so this cannot sit behind sign-in the way the claim
 * flow does. The `token` is a signed value the /listings/remove route checks
 * before it suppresses anything, so the link is safe to put in an inbox: it is
 * pure string building here, and the signing and checking live in apps/web,
 * which has the secret and the crypto this package deliberately does not.
 */
export function removeListingUrl(entityType: string, entityId: string, token: string): string {
  return (
    `${siteUrl()}/listings/remove?type=${encodeURIComponent(entityType)}` +
    `&id=${encodeURIComponent(entityId)}&token=${encodeURIComponent(token)}`
  )
}
