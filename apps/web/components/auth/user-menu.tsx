'use client'

import { useState } from 'react'
import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { signOut } from '@/lib/auth/client'
import { useSession } from './session-provider'
import { SignInDialog } from './sign-in-dialog'

/**
 * Header slot: a sign-in button when signed out, an avatar menu when signed
 * in. Sits in every vertical's header so the account is obviously one account.
 */
export function UserMenu() {
  const { user, loading, refresh } = useSession()
  const [dialogOpen, setDialogOpen] = useState(false)

  if (loading) {
    return <div className="h-8 w-8 rounded-full bg-surface" aria-hidden />
  }

  if (!user) {
    return (
      <>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="shrink-0 whitespace-nowrap rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
        >
          Sign in
        </button>
        <SignInDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    )
  }

  const label = user.displayName || user.email || 'Account'
  const initial = label.charAt(0).toUpperCase()

  return (
    <DropdownMenu.Root>
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
          <MenuLink href="/me">Saved items</MenuLink>
          <MenuLink href="/me/team">My teams</MenuLink>
          <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
          <DropdownMenu.Item
            onSelect={() => {
              void signOut().then(refresh)
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
