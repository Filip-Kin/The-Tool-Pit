'use client'

import { useState } from 'react'
import { ShieldCheck, Pencil, Clock, Check, Link2 } from 'lucide-react'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { claimAffordance } from '@/lib/listings/claim-affordance'
import { CardMenu, CardMenuAction, CardMenuLink, CardMenuNote, CardMenuSeparator } from '@/components/ui/card-menu'

/**
 * The overflow menu for an album.
 *
 * Albums have no detail page: a card links straight out to the photographer's
 * gallery, so there was nowhere on this site to put an ownership control and
 * therefore no way for a photographer to claim their own album. The card is
 * the only surface an album has, so the control goes on the card.
 *
 * Used by the album card and, for an event whose single album the event card
 * links straight to, by that event card. Same component in both places on
 * purpose: for a one album event the card IS the album, so it should offer the
 * same menu with the same items in the same order.
 *
 * The state is resolved on the server for the whole grid and handed down. This
 * component only draws it.
 */
export function AlbumMenu({
  albumId,
  albumUrl,
  claimState,
}: {
  albumId: string
  albumUrl: string
  claimState: ListingClaimState
}) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const affordance = claimAffordance('album', albumId, claimState)

  async function copy() {
    try {
      await navigator.clipboard.writeText(albumUrl)
      setCopied('done')
    } catch {
      // Clipboard access is refused outside a secure context and in some
      // embedded browsers. Say so rather than showing a tick for nothing.
      setCopied('failed')
    }
  }

  return (
    <CardMenu label="Album options" onOpenChange={() => setCopied('idle')}>
      <CardMenuAction
        icon={copied === 'done' ? <Check className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
        // Keep the menu open: there is no toast in this app, so the item itself
        // is the only place the copy can confirm it worked.
        keepOpen
        onSelect={() => void copy()}
      >
        {copied === 'done' ? 'Link copied' : copied === 'failed' ? 'Copy failed' : 'Copy album link'}
      </CardMenuAction>

      {affordance && (
        <>
          <CardMenuSeparator />
          {affordance.kind === 'pending' ? (
            <CardMenuNote icon={<Clock className="h-4 w-4" aria-hidden />}>{affordance.label}</CardMenuNote>
          ) : (
            <CardMenuLink
              href={affordance.href}
              icon={
                affordance.kind === 'edit' ? (
                  <Pencil className="h-4 w-4" aria-hidden />
                ) : (
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                )
              }
            >
              {affordance.label}
            </CardMenuLink>
          )}
        </>
      )}
    </CardMenu>
  )
}
