'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { useSession } from './session-provider'
import { SignInDialog } from './sign-in-dialog'

/**
 * "Claim this listing" for a visitor who is not signed in.
 *
 * The control used to render nothing at all when signed out, reasoning that
 * claiming needs an account so the button was really a sign-in prompt nobody
 * asked for. That was backwards. Somebody who runs the field, shot the photos
 * or wrote the tool has no way to learn they can say so, and the whole point of
 * the control is to tell them.
 *
 * So it asks, and then carries on to the same claim page rather than dropping
 * them wherever sign-in happened to land. Same replay pattern as
 * FavoriteButton: the click they made is the click that happens.
 */
export function ClaimSignInLink({
  href,
  label,
  className,
}: {
  href: string
  label: string
  className?: string
}) {
  const { user } = useSession()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // Only follow through for somebody who asked. Without this, a visitor already
  // signed in on another tab would be navigated to a claim page they never
  // clicked towards the moment the session resolved.
  const asked = useRef(false)

  useEffect(() => {
    if (user && asked.current) {
      asked.current = false
      router.push(href)
    }
  }, [user, href, router])

  return (
    <>
      <button
        type="button"
        onClick={() => {
          asked.current = true
          setOpen(true)
        }}
        className={className}
      >
        <ShieldCheck className="h-4 w-4" aria-hidden />
        {label}
      </button>

      <SignInDialog
        open={open}
        onOpenChange={(next) => {
          // Closing the dialog without signing in cancels the follow through,
          // so a later sign-in somewhere else does not navigate them here.
          if (!next) asked.current = false
          setOpen(next)
        }}
        reason="Sign in to claim this listing. It stays yours to edit afterwards."
      />
    </>
  )
}
