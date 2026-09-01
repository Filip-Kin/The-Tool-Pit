'use client'

import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useSession } from './session-provider'
import type { ListingEntityType } from '@the-tool-pit/db'

/**
 * "Claim this listing" for a public detail page.
 *
 * Signed out, this renders NOTHING. Claiming is only meaningful once you have
 * an account, so a signed-out visitor was being offered a button whose only
 * outcome was a sign-in prompt they never asked for. Anonymous submit and
 * suggest-edit are untouched, which is what that visitor actually wants.
 *
 * Signed in, it goes to the claim page, which picks the verification path:
 * the field you submitted, a token in your tool's repo, or a human review.
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
  if (!user) return null

  return (
    <Link
      href={`/me/listings/claim?type=${entityType}&id=${entityId}`}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground',
        className,
      )}
    >
      <ShieldCheck className="h-4 w-4" aria-hidden />
      Claim this listing
    </Link>
  )
}
