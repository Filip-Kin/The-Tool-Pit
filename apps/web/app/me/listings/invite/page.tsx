import type { Metadata } from 'next'
import { MeShell } from '@/components/me/me-shell'
import { InviteAccepter } from '@/components/me/invite-accepter'
import { SignedInGate } from '@/components/auth/signed-in-gate'
import { acceptInvite } from '../actions'

export const metadata: Metadata = {
  title: 'Accept invite',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  return (
    <MeShell
      title="Listing invite"
      intro="Someone who manages a listing has invited you to help edit it."
      active="listings"
    >
      {token ? (
        // Signed out, the page stays put behind the gate so the token in the URL
        // survives sign-in instead of being lost to a redirect.
        <SignedInGate reason="Sign in to accept this invite.">
          <InviteAccepter token={token} acceptAction={acceptInvite} />
        </SignedInGate>
      ) : (
        <div className="rounded-lg border border-border-subtle bg-surface p-5 text-sm text-muted">
          This invite link is missing its token. Ask whoever sent it for a fresh link.
        </div>
      )}
    </MeShell>
  )
}
