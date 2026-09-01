'use client'

import { useState } from 'react'
import { useSession } from './session-provider'
import { SignInDialog } from './sign-in-dialog'

/**
 * Show children only to a signed-in viewer, otherwise a sign-in prompt.
 *
 * Used by the claim and invite pages so a signed-out visitor keeps the page
 * (and its token in the URL) instead of being redirected away and losing it.
 * Signing in through the dialog updates the session in place, so the children
 * appear without a navigation and the token survives.
 */
export function SignedInGate({ reason, children }: { reason: string; children: React.ReactNode }) {
  const { user, loading } = useSession()
  const [dialogOpen, setDialogOpen] = useState(false)

  if (user) return <>{children}</>

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-5">
      <p className="text-sm text-muted">{reason}</p>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={loading}
        className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
      >
        Sign in
      </button>
      <SignInDialog open={dialogOpen} onOpenChange={setDialogOpen} reason={reason} />
    </div>
  )
}
