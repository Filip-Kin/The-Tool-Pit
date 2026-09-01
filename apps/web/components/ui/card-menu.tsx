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
 * The trigger belongs on the card's TITLE row, pushed to the right, not on a
 * row of its own underneath. It started in the top corner of the thumbnail,
 * where it was easy to miss and had no contrast it could count on, and then
 * spent a version on its own line below the details, which just added an empty
 * band to every card.
 *
 * Bare dots, no border and no background. A bordered pill reads as a primary
 * control, and this is an overflow affordance sitting next to a title. The hit
 * area is kept honest with padding and a hover surface rather than an outline.
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
          className="-mr-1 inline-flex shrink-0 items-center rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground data-[state=open]:bg-surface-2 data-[state=open]:text-foreground"
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
