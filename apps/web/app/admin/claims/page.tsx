import { assertAdmin } from '@/lib/admin/auth'
import { listPendingClaimsForAdmin } from '@/lib/queries/listing-ownership'
import { adminResolveClaim } from '@/app/me/listings/actions'
import { ListingClaimReview } from '@/components/me/listing-claim-review'

/**
 * Listing claim review, in the admin dashboard where it belongs.
 *
 * It used to render only at the bottom of /me/listings, behind the `is_admin`
 * flag on the signed-in Firebase user. That was the wrong place twice over.
 * An admin looking for a review queue looks in the dashboard, and the two admin
 * identities are not the same thing: /admin is gated by the Authelia OIDC
 * cookie, while `users.is_admin` is a column on the Firebase-linked account, so
 * being an admin of this dashboard did not make the queue appear on /me at all.
 *
 * This page gates on assertAdmin, the same check every other admin page uses,
 * so the dashboard is self-consistent. The /me copy stays for an admin who
 * happens to be there, and both call the same server action.
 */
export const dynamic = 'force-dynamic'

export default async function AdminClaimsPage() {
  await assertAdmin()
  const claims = await listPendingClaimsForAdmin()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Listing claims</h1>
        <p className="mt-1 text-sm text-muted">
          {claims.length === 0
            ? 'Nothing waiting.'
            : `${claims.length} waiting on a decision.`}
        </p>
      </div>

      {claims.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">
          Claims that cannot be proved automatically land here. A field the claimant submitted, or a
          tool whose repo carries the verification file, is granted without review and never appears.
        </div>
      ) : (
        <ListingClaimReview claims={claims} resolveAction={adminResolveClaim} />
      )}
    </div>
  )
}
