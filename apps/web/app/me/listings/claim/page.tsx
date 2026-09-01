import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { ClaimStarter } from '@/components/me/claim-starter'
import { isListingEntityType, resolveClaimable, VERIFY_FILENAME } from '@/lib/queries/listing-ownership'
import { startClaim } from '../actions'

export const metadata: Metadata = {
  title: 'Claim a listing',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; id?: string }>
}) {
  const { type, id } = await searchParams
  const user = await getCurrentUser()
  // Bounce through sign-in and come back here, so the claim button on a public
  // page works for someone who is not signed in yet.
  if (!user) redirect(`/?signin=1&next=${encodeURIComponent(`/me/listings/claim?type=${type ?? ''}&id=${id ?? ''}`)}`)

  const valid = type && id && isListingEntityType(type)
  const target = valid ? await resolveClaimable(user.id, type, id) : null

  return (
    <MeShell
      title="Claim a listing"
      intro="Prove you run a listing and you can edit it directly. This never removes it from anyone; contributing without an account still works everywhere."
      active="listings"
    >
      {target ? (
        <ClaimStarter target={target} verifyFilename={VERIFY_FILENAME} startAction={startClaim} />
      ) : (
        <div className="rounded-lg border border-border-subtle bg-surface p-5 text-sm text-muted">
          <p>We could not find that listing to claim.</p>
          <p className="mt-3">
            Open the tool, album or practice field you run and use its &ldquo;Claim this listing&rdquo;
            button, or head to{' '}
            <a href="/me/listings" className="text-primary hover:underline">
              your listings
            </a>
            .
          </p>
        </div>
      )}
    </MeShell>
  )
}
