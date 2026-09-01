import type { ListingEntityType } from '@the-tool-pit/db'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'

/**
 * The one ownership control a visitor should see, given the resolved state.
 *
 * Two surfaces draw this now: the button on a detail page and the item in an
 * album card's overflow menu. The four-case decision is the part that is easy
 * to get subtly different between them, and a menu that offers "Claim this
 * listing" next to a page that says "Edit your listing" is the same bug the
 * server-resolved state was added to kill. So the decision lives here once and
 * each surface only chooses how to draw it.
 *
 * Pure, and type-only imports, so a client component can call it too. The
 * state itself still comes from the server.
 *
 * The label stays generic on purpose. /me/listings/claim and the empty state
 * on /me/listings both tell people to look for a control called "Claim this
 * listing", so naming it after its vertical here would make that instruction
 * wrong on every page it points at.
 */
export type ClaimAffordance =
  | { kind: 'edit'; label: string; href: string }
  | { kind: 'pending'; label: string }
  | { kind: 'claim'; label: string; href: string; signInFirst?: boolean }

/** Null only for someone else's listing, where there is nothing honest to offer. */
export function claimAffordance(
  entityType: ListingEntityType,
  entityId: string,
  state: ListingClaimState,
): ClaimAffordance | null {
  if (state === 'owned_by_other') return null
  // Signed out still gets the offer. It used to render nothing, on the grounds
  // that claiming needs an account so the button was really a sign-in prompt.
  // That reasoning was backwards: a visitor who owns the thing has no way to
  // learn they CAN claim it, and the control is how a directory says so. It
  // asks them to sign in, then carries on to the same claim page.
  if (state === 'signed_out') {
    return { kind: 'claim', label: 'Claim this listing', href: claimHref(entityType, entityId), signInFirst: true }
  }
  if (state === 'owner') {
    return { kind: 'edit', label: 'Edit your listing', href: `/me/listings/${entityType}/${entityId}` }
  }
  if (state === 'claim_pending') return { kind: 'pending', label: 'Claim under review' }
  return { kind: 'claim', label: 'Claim this listing', href: claimHref(entityType, entityId) }
}

function claimHref(entityType: ListingEntityType, entityId: string): string {
  return `/me/listings/claim?type=${entityType}&id=${entityId}`
}
