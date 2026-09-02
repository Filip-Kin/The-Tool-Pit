'use client'

import { useState } from 'react'
import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { signOut } from '@/lib/auth/client'
import { useSession } from './session-provider'
import { SignInDialog } from './sign-in-dialog'

/**
 * Header slot: a sign-in button when signed out, an avatar menu when signed
 * in. Sits in every vertical's header so the account is obviously one account.
 */
export function UserMenu() {
  const { user, loading, refresh } = useSession()
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)

  if (loading) {
    return <div className="h-8 w-8 rounded-full bg-surface" aria-hidden />
  }

  if (!user) {
    return (
      <>
        <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
          Sign in
        </Button>
        <SignInDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    )
  }

  const label = user.displayName || user.email || 'Account'
  const initial = label.charAt(0).toUpperCase()

  // modal={false} on purpose. Radix defaults a dropdown to modal, which locks
  // body scroll and pads the body by the scrollbar width to compensate. A
  // sticky header is not the body, so it never got that padding, and the whole
  // page slid sideways by a few pixels while the menu was open. A profile menu
  // has no reason to trap the page anyway.
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${label}`}
          className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-surface text-sm font-medium text-foreground"
        >
          {user.photoUrl ? (
            // Provider avatars are arbitrary external URLs, so a plain img
            // avoids adding every provider host to next/image remotePatterns.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-48 rounded-md border border-border-subtle bg-background p-1 shadow-xl"
        >
          <div className="px-3 py-2 text-xs text-muted">{user.email ?? label}</div>
          <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
          {/* One entry per /me tab, in the order MeShell shows them. The menu
              had two of the four, so Listings and Notifications were reachable
              only by already being on a /me page, which is the one place you do
              not need a link to them.

              Bare nouns, no possessive. The four labels used to read "Saved
              items", "Your listings", "My teams" and "Notifications": three
              voices in four items. The menu hangs off your own avatar and the
              tabs sit under your own header, so whose they are is already
              said. */}
          <MenuLink href="/me">Bookmarks</MenuLink>
          <MenuLink href="/me/listings">Listings</MenuLink>
          <MenuLink href="/me/team">Teams</MenuLink>
          <MenuLink href="/me/notifications">Notifications</MenuLink>
          <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
          <DropdownMenu.Item
            onSelect={() => {
              void signOut()
                .then(refresh)
                // refresh() updates this provider's user, which is enough for
                // the header and nothing else. Every server component that
                // asked who you were, the claim control, the saved hearts, the
                // upvotes, is baked into the RSC payload sitting in the router
                // cache, so the page went on showing the signed-in answer.
                // router.refresh() drops that cache and re-renders them.
                .then(() => router.refresh())
            }}
            className="cursor-pointer rounded px-3 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-surface"
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <DropdownMenu.Item asChild>
      <Link
        href={href}
        className="block cursor-pointer rounded px-3 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-surface"
      >
        {children}
      </Link>
    </DropdownMenu.Item>
  )
}
