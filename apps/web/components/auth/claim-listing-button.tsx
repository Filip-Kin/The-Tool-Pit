'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useSession } from './session-provider'
import { SignInDialog } from './sign-in-dialog'
import type { ListingEntityType } from '@the-tool-pit/db'

/**
 * "Claim this listing" for a public detail page.
 *
 * Additive to anonymous use: it never blocks submitting or suggesting an edit,
 * it just offers a signed-in person a way to prove they run this listing and
 * edit it directly. Signed out, it opens the sign-in dialog rather than doing
 * nothing. Signed in, it hands off to the claim page, which picks the
 * verification path (repo token, your own submission, or a human review).
 */
export function ClaimListingButton({
  entityType,
  entityId,
  className,
}: {
  entityType: ListingEntityType
  entityId: string
  className?: string
}) {
  const { user } = useSession()
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)

  const href = `/me/listings/claim?type=${entityType}&id=${entityId}`

  function onClick() {
    if (!user) {
      setDialogOpen(true)
      return
    }
    router.push(href)
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground',
          className,
        )}
      >
        <ShieldCheck className="h-4 w-4" aria-hidden />
        Claim this listing
      </button>
      <SignInDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reason="Sign in to claim a listing you run and edit it directly"
      />
    </>
  )
}
