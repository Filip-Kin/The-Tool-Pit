'use client'

import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

/**
 * The three dot menu on a card.
 *
 * There is more than one card that needs one now, and two cards carrying the
 * same control with different padding, a different trigger and a different
 * highlight is the exact kind of near-miss that makes a site feel assembled
 * rather than built. So the trigger, the panel and the item live here once and
 * a card supplies only the items.
 *
 * The trigger belongs in the card FOOTER, next to whatever other controls that
 * card has. It started in the top corner of the thumbnail and was easy to
 * miss there, and a control laid over a photo has no contrast it can count on.
 * It is styled to sit beside FavoriteButton, which is the other thing living
 * in that row.
 *
 * Item classes match components/auth/user-menu.tsx, which was the first menu in
 * the app and is still the reference.
 */
const ITEM =
  'flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm outline-none data-[highlighted]:bg-surface'

export function CardMenu({
  label,
  onOpenChange,
  children,
}: {
  /** Names the thing the menu acts on, for screen readers. */
  label: string
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}) {
  // modal={false} for the reason spelled out in components/auth/user-menu.tsx:
  // a modal Radix dropdown locks body scroll and pads the body by the scrollbar
  // width, which a sticky header never gets, so the page slides sideways while
  // the menu is open. A card menu has no reason to trap the page either.
  return (
    <DropdownMenu.Root modal={false} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex shrink-0 items-center rounded-full border border-border-subtle bg-background/80 p-1.5 text-muted transition-colors hover:text-foreground"
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
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function CardMenuLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <DropdownMenu.Item asChild>
      <Link href={href} className={cn(ITEM, 'cursor-pointer text-foreground')}>
        {icon}
        {children}
      </Link>
    </DropdownMenu.Item>
  )
}

export function CardMenuAction({
  icon,
  onSelect,
  keepOpen,
  children,
}: {
  icon: React.ReactNode
  onSelect: () => void
  /** Keep the panel open so the item itself can report what happened. */
  keepOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <DropdownMenu.Item
      onSelect={(e) => {
        if (keepOpen) e.preventDefault()
        onSelect()
      }}
      className={cn(ITEM, 'cursor-pointer text-foreground')}
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  )
}

/** A line of state, not a thing to click. Skips DropdownMenu.Item so it takes no focus. */
export function CardMenuNote({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn(ITEM, 'text-muted')}>
      {icon}
      {children}
    </div>
  )
}

export function CardMenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
}
