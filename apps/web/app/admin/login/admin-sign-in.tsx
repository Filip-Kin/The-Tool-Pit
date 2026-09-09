'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SignInDialog } from '@/components/auth/sign-in-dialog'

/**
 * The site's normal sign-in dialog, pointed back at /admin. The server page
 * around this decides what to show (sign in, or "not an admin") from the
 * session cookie; this component only opens the dialog.
 */
export function AdminSignIn() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)} className="w-full">
        Sign in
      </Button>
      <SignInDialog open={open} onOpenChange={setOpen} reason="Admins only." returnTo="/admin" />
    </>
  )
}
