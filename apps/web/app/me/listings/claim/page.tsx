import type { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { ClaimStarter } from '@/components/me/claim-starter'
import { GithubLinkCard } from '@/components/me/github-link-card'
import { SignedInGate } from '@/components/auth/signed-in-gate'
import { isListingEntityType, resolveClaimable, VERIFY_FILENAME } from '@/lib/queries/listing-ownership'
import { startClaim, verifyRepoClaim } from '../actions'

export const metadata: Metadata = {
  title: 'Claim a listing',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; id?: string; t?: string }>
}) {
  const { type, id, t } = await searchParams
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
      intro="Prove you run a listing and you can edit it directly. This never removes it from anyone; contributing without an account still works everywhere. Your email is only used for us and other managers to reach you, and is never shown on the public listing."
      active="listings"
    >
      {target ? (
        <SignedInGate reason="Sign in, or create a free account, to claim a listing you run. It takes a moment and lets you edit the listing directly - Google, GitHub or an email and password all work.">
          <div className="flex flex-col gap-6">
            {/* The fast path, and only where it IS one. A listing with no
                GitHub repository behind it cannot be claimed this way, so the
                card would be an unrelated ask sitting on top of the thing the
                person came to do. The card itself renders nothing once the
                account is linked. */}
            {target.repoUrl && <GithubLinkCard purpose="claim" />}
            <ClaimStarter target={target} verifyFilename={VERIFY_FILENAME} startAction={startClaim} verifyAction={verifyRepoClaim} claimToken={t} />
          </div>
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
