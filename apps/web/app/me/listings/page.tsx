import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { OwnedListings } from '@/components/me/owned-listings'
import { PendingClaims } from '@/components/me/pending-claims'
import { GithubLinkCard } from '@/components/me/github-link-card'
import {
  listOwnedListings,
  listClaimsForUser,
  VERIFY_FILENAME,
} from '@/lib/queries/listing-ownership'
import { verifyRepoClaim } from './actions'

export const metadata: Metadata = {
  title: 'Listings',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function ListingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const [owned, claims] = await Promise.all([
    listOwnedListings(user.id),
    listClaimsForUser(user.id),
  ])
  // Settled claims are shown alongside owned listings elsewhere; here we only
  // surface the ones still needing attention or waiting.
  const openClaims = claims.filter((c) => c.status === 'pending')

  return (
    <MeShell
      title="Listings"
      intro="Tools, albums, practice fields, off-season events and grants you run."
      active="listings"
    >
      <div className="flex flex-col gap-12">
        {/* Above the list on purpose. For a repo-backed listing this is the
            one-click route to ownership, and the claim flow below it is the
            slow path somebody falls back to. Once the account is linked it
            collapses to a single line with the re-check on it. */}
        <GithubLinkCard showWhenLinked />
        <OwnedListings listings={owned} />
        <PendingClaims claims={openClaims} verifyFilename={VERIFY_FILENAME} verifyAction={verifyRepoClaim} />

        {/* The one fact here that is not obvious: a claim never takes a listing
            off whoever holds it. */}
        <p className="text-sm text-muted-2">
          Claiming never takes a listing from its current owner. An owner can invite others with a
          single-use link.
        </p>
      </div>
    </MeShell>
  )
}
