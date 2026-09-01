import Link from 'next/link'
import { ShieldCheck, Pencil, Clock } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { ListingEntityType } from '@the-tool-pit/db'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { claimAffordance } from '@/lib/listings/claim-affordance'
import { ClaimSignInLink } from './claim-sign-in-link'

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
// A quiet link, not a button.
//
// It was a bordered box the size of a call to action, and on a detail page it
// broke the layout in half for something almost nobody on that page is there to
// do. Ownership is an aside: the reader wants the tool, and one reader in a
// hundred also happens to run it. So it reads as a link and gets out of the way.
//
// One of the three is a <span>, because "waiting on a moderator" is a state
// rather than something to press, so this is classes and not a component.
const LINK =
  'inline-flex items-center gap-1.5 text-sm text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline'

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
      <Link href={affordance.href} className={cn(LINK, className)}>
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        {affordance.label}
      </Link>
    )
  }

  if (affordance.kind === 'pending') {
    return (
      <span className={cn(LINK, 'cursor-default text-muted no-underline hover:text-muted hover:no-underline', className)}>
        <Clock className="h-3.5 w-3.5" aria-hidden />
        {affordance.label}
      </span>
    )
  }

  // Signed out, the same offer needs a sign-in on the way through, and that
  // needs browser state, so it is the one case drawn by a client component.
  if (affordance.signInFirst) {
    return (
      <ClaimSignInLink
        href={affordance.href}
        label={affordance.label}
        className={cn(LINK, className)}
      />
    )
  }

  return (
    <Link href={affordance.href} className={cn(LINK, className)}>
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
      {affordance.label}
    </Link>
  )
}
