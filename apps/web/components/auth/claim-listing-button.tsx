import Link from 'next/link'
import { ShieldCheck, Pencil, Clock } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { ListingEntityType } from '@the-tool-pit/db'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'

/**
 * The ownership control on a public detail page.
 *
 * It used to be a client component that rendered "Claim this listing" to
 * anyone signed in, on every listing, whether or not the listing was already
 * claimed and whether or not the visitor was the person who claimed it. Being
 * invited to claim your own listing reads as broken however the claim page
 * then behaves.
 *
 * Now the page resolves the state on the server and this renders the one thing
 * that is true. It is no longer a client component: none of the four outcomes
 * needs browser state, and doing it on the server means the first paint is
 * already right instead of flashing a claim button at the owner.
 */
const BUTTON =
  'inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-sm font-medium transition-colors'

export function ClaimListingButton({
  entityType,
  entityId,
  state,
  className,
}: {
  entityType: ListingEntityType
  entityId: string
  state: ListingClaimState
  className?: string
}) {
  // Signed out, claiming needs an account, so offering it is a sign-in prompt
  // nobody asked for. Someone else's listing is not this visitor's business.
  if (state === 'signed_out' || state === 'owned_by_other') return null

  if (state === 'owner') {
    return (
      <Link
        href={`/me/listings/${entityType}/${entityId}`}
        className={cn(BUTTON, 'text-foreground hover:bg-surface-3', className)}
      >
        <Pencil className="h-4 w-4" aria-hidden />
        Edit your listing
      </Link>
    )
  }

  if (state === 'claim_pending') {
    return (
      <span className={cn(BUTTON, 'cursor-default text-muted', className)}>
        <Clock className="h-4 w-4" aria-hidden />
        Claim under review
      </span>
    )
  }

  return (
    <Link
      href={`/me/listings/claim?type=${entityType}&id=${entityId}`}
      className={cn(BUTTON, 'text-muted hover:text-foreground', className)}
    >
      <ShieldCheck className="h-4 w-4" aria-hidden />
      Claim this listing
    </Link>
  )
}
