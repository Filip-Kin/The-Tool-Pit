import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { InviteAccepter } from '@/components/me/invite-accepter'
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
  const user = await getCurrentUser()
  if (!user) {
    // Sign in, then land back on the invite with its token intact.
    redirect(`/?signin=1&next=${encodeURIComponent(`/me/listings/invite?token=${token ?? ''}`)}`)
  }

  return (
    <MeShell
      title="Listing invite"
      intro="Someone who manages a listing has invited you to help edit it."
      active="listings"
    >
      {token ? (
        <InviteAccepter token={token} acceptAction={acceptInvite} />
      ) : (
        <div className="rounded-lg border border-border-subtle bg-surface p-5 text-sm text-muted">
          This invite link is missing its token. Ask whoever sent it for a fresh link.
        </div>
      )}
    </MeShell>
  )
}
