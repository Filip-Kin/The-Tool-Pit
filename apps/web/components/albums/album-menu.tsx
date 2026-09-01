'use client'

import { useState } from 'react'
import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreVertical, ShieldCheck, Pencil, Clock, Check, Link2 } from 'lucide-react'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { claimAffordance } from '@/lib/listings/claim-affordance'

/**
 * The overflow menu on an album card.
 *
 * Albums have no detail page: a card links straight out to the photographer's
 * gallery, so there was nowhere on this site to put an ownership control and
 * therefore no way for a photographer to claim their own album. The card is
 * the only surface an album has, so the control goes on the card.
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

  // modal={false} for the reason spelled out in components/auth/user-menu.tsx:
  // a modal Radix dropdown locks body scroll and pads the body by the scrollbar
  // width, which a sticky header never gets, so the page slides sideways while
  // the menu is open. A card menu has no reason to trap the page either.
  return (
    <DropdownMenu.Root modal={false} onOpenChange={() => setCopied('idle')}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Album options"
          className="rounded-md bg-black/60 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
        >
          <MoreVertical className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-52 rounded-md border border-border-subtle bg-background p-1 shadow-xl"
        >
          <DropdownMenu.Item
            onSelect={(e) => {
              // Keep the menu open: there is no toast in this app, so the item
              // itself is the only place the copy can confirm it worked.
              e.preventDefault()
              void copy()
            }}
            className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-surface"
          >
            {copied === 'done' ? <Check className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
            {copied === 'done' ? 'Link copied' : copied === 'failed' ? 'Copy failed' : 'Copy album link'}
          </DropdownMenu.Item>

          {affordance && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
              {affordance.kind === 'pending' ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
                  <Clock className="h-4 w-4" aria-hidden />
                  {affordance.label}
                </div>
              ) : (
                <DropdownMenu.Item asChild>
                  <Link
                    href={affordance.href}
                    className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-surface"
                  >
                    {affordance.kind === 'edit' ? (
                      <Pencil className="h-4 w-4" aria-hidden />
                    ) : (
                      <ShieldCheck className="h-4 w-4" aria-hidden />
                    )}
                    {affordance.label}
                  </Link>
                </DropdownMenu.Item>
              )}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
