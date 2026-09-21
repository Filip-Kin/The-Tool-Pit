import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { listingClaims, listingOwners } from '@the-tool-pit/db'
import { isListingEntityType } from '@/lib/queries/listing-ownership'
import { notifyClaimResolved } from '@/lib/notify/approvals'

/**
 * Settle a pending claim, by admin decision. One body for the admin page and
 * for a reaction in Discord, so both write the same rows.
 *
 * `decidedByUserId` is an audit stamp, not an authorization gate: null for the
 * break-glass cookie admin and for a Discord member, neither of whom has an
 * app user row. The caller has already decided the actor is allowed.
 *
 * The note is OPTIONAL on an approval and REQUIRED on a rejection. Approving
 * explains itself: the claimant now manages the listing and can see that they
 * do. A rejection explains nothing on its own, and "no" with no reason is the
 * thing people write back about, so the note is the body of the email and the
 * decision does not go through without one.
 */
export async function resolveClaim(
  claimId: string,
  approve: boolean,
  note: string | null,
  decidedByUserId: string | null,
): Promise<{ error?: string; message?: string }> {
  const cleanNote = note?.trim() || null
  if (!approve && !cleanNote) {
    return { error: 'Give a reason for turning the claim down. It is what the claimant is told.' }
  }

  const db = getDb()
  const [claim] = await db.select().from(listingClaims).where(eq(listingClaims.id, claimId)).limit(1)
  if (!claim) return { error: 'We could not find that claim.' }
  if (claim.status !== 'pending') return { message: 'This claim is already settled.' }
  if (!isListingEntityType(claim.entityType)) return { error: 'Unknown listing type.' }

  if (approve) {
    // An admin can grant even when the listing is already owned: this is how a
    // dispute is resolved or a co-owner added. Deliberately additive. Same
    // insert as the grantOwnership choke point in app/me/listings/actions.ts;
    // verifiedVia 'admin' is the audit trail.
    await db
      .insert(listingOwners)
      .values({ entityType: claim.entityType, entityId: claim.entityId, userId: claim.userId, role: 'owner', verifiedVia: 'admin', invitedBy: null })
      .onConflictDoNothing()
  }
  await db
    .update(listingClaims)
    .set({
      status: approve ? 'verified' : 'rejected',
      reviewerNote: cleanNote,
      decidedByUserId,
      decidedAt: new Date(),
    })
    .where(eq(listingClaims.id, claim.id))

  // A rejection is not an approval, and it gets its own email saying so, with
  // the reviewer's note verbatim. Guarded above by the status !== 'pending'
  // check, so a second decision cannot send a second time.
  await notifyClaimResolved(
    claim.id,
    claim.entityType,
    claim.entityId,
    claim.userId,
    approve ? 'verified' : 'rejected',
    cleanNote,
  )
  return { message: approve ? 'Claim approved.' : 'Claim rejected.' }
}
