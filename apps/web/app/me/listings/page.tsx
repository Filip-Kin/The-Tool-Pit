import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { OwnedListings } from '@/components/me/owned-listings'
import { PendingClaims } from '@/components/me/pending-claims'
import { ListingClaimReview } from '@/components/me/listing-claim-review'
import {
  listOwnedListings,
  listClaimsForUser,
  listPendingClaimsForAdmin,
  VERIFY_FILENAME,
} from '@/lib/queries/listing-ownership'
import { adminResolveClaim, removeOwner, verifyRepoClaim } from './actions'

export const metadata: Metadata = {
  title: 'Your listings',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function ListingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const [owned, claims, adminClaims] = await Promise.all([
    listOwnedListings(user.id),
    listClaimsForUser(user.id),
    // Only load the review queue for an actual admin. isAdmin is a DB flag.
    user.isAdmin ? listPendingClaimsForAdmin() : Promise.resolve([]),
  ])
  // Settled claims are shown alongside owned listings elsewhere; here we only
  // surface the ones still needing attention or waiting.
  const openClaims = claims.filter((c) => c.status === 'pending')

  return (
    <MeShell
      title="Your listings"
      intro="Tools, photo albums and practice fields you run. Claim the ones you own to edit them directly; anyone can still submit and suggest edits without signing in."
      active="listings"
    >
      <div className="flex flex-col gap-12">
        <OwnedListings listings={owned} leaveAction={removeOwner} />
        <PendingClaims claims={openClaims} verifyFilename={VERIFY_FILENAME} verifyAction={verifyRepoClaim} />
        {user.isAdmin && <ListingClaimReview claims={adminClaims} resolveAction={adminResolveClaim} />}

        <p className="max-w-2xl text-sm text-muted-2">
          Claiming a listing does not take it away from anyone. If someone already manages it, your
          claim goes to a person for review rather than switching control, and a listing&apos;s owner
          can invite others with a single-use link.
        </p>
      </div>
    </MeShell>
  )
}
