import type { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { ClaimStarter } from '@/components/me/claim-starter'
import { SignedInGate } from '@/components/auth/signed-in-gate'
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

  // Resolve for display with a best-effort user id when signed out: the page
  // stays put (its token in the URL) behind a sign-in gate rather than being
  // redirected away and losing it. startClaim re-resolves ownership server-side
  // from the real session, so the displayed path is cosmetic, never the gate.
  const valid = type && id && isListingEntityType(type)
  const target = valid ? await resolveClaimable(user?.id ?? '', type, id) : null

  return (
    <MeShell
      title="Claim a listing"
      intro="Prove you run a listing and you can edit it directly. This never removes it from anyone; contributing without an account still works everywhere."
      active="listings"
    >
      {target ? (
        <SignedInGate reason="Sign in to claim a listing you run.">
          <ClaimStarter target={target} verifyFilename={VERIFY_FILENAME} startAction={startClaim} />
        </SignedInGate>
      ) : (
        <div className="rounded-lg border border-border-subtle bg-surface p-5 text-sm text-muted">
          <p>We could not find that listing to claim.</p>
          <p className="mt-3">
            Open the tool, album, practice field or off-season event you run and use its &ldquo;Claim this listing&rdquo;
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
