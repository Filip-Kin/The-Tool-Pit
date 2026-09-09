import { assertAdmin } from '@/lib/admin/auth'
import { listPendingClaimsForAdmin } from '@/lib/queries/listing-ownership'
import { adminResolveClaim } from '@/app/me/listings/actions'
import { ListingClaimReview } from '@/components/me/listing-claim-review'

/**
 * Listing claim review, in the admin dashboard where it belongs.
 *
 * It used to render only at the bottom of /me/listings. An admin looking for a
 * review queue looks in the dashboard, so it lives here too.
 *
 * This page gates on assertAdmin, the same check every other admin page uses
 * (users.is_admin on the signed-in account). The /me copy stays for an admin
 * who happens to be there, and both call the same server action.
 */
export const dynamic = 'force-dynamic'

export default async function AdminClaimsPage() {
  await assertAdmin()
  const claims = await listPendingClaimsForAdmin()

  return (
    // Padding here, not on the layout: every admin page owns its own, and this
    // one was the only one with none, so it sat flush against the sidebar.
    <div className="flex flex-col gap-6 p-4 md:p-8">
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
