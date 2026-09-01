import Link from 'next/link'
import { ShieldCheck, Pencil, Clock } from 'lucide-react'
import { buttonClass } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import type { ListingEntityType } from '@the-tool-pit/db'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { claimAffordance } from '@/lib/listings/claim-affordance'

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
 *
 * No 'use client' either, so the practice field dialog can pull it into its own
 * client tree and get the same control the /fields/[id] page renders. Nothing
 * here touches a server API, only the state prop, which is why that works.
 */
// One of the three is a <span>, because "waiting on a moderator" is a state
// rather than something to press, so this takes the box and not the component.
const BUTTON = buttonClass({ variant: 'none', className: 'border border-border-subtle bg-surface-2' })

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
  const affordance = claimAffordance(entityType, entityId, state)
  if (!affordance) return null

  if (affordance.kind === 'edit') {
    return (
      <Link href={affordance.href} className={cn(BUTTON, 'text-foreground hover:bg-surface-3', className)}>
        <Pencil className="h-4 w-4" aria-hidden />
        {affordance.label}
      </Link>
    )
  }

  if (affordance.kind === 'pending') {
    return (
      <span className={cn(BUTTON, 'cursor-default text-muted', className)}>
        <Clock className="h-4 w-4" aria-hidden />
        {affordance.label}
      </span>
    )
  }

  return (
    <Link href={affordance.href} className={cn(BUTTON, 'text-muted hover:text-foreground', className)}>
      <ShieldCheck className="h-4 w-4" aria-hidden />
      {affordance.label}
    </Link>
  )
}
