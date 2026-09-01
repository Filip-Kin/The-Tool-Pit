'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export interface MobileNavItem {
  href: string
  label: string
  /** Rendered as the filled button at the bottom of the sheet. One per menu. */
  primary?: boolean
}

/**
 * The header's small-screen nav.
 *
 * The tools header carries a wordmark, a search box, three program links,
 * Robot Code / CAD, Submit and the account menu. That does not fit on a phone,
 * and it was overflowing rather than wrapping. Below lg the links move in here
 * behind a hamburger; the wordmark and the account menu stay in the bar,
 * because signing in is the one thing you should never have to open a menu to
 * find.
 *
 * Deliberately not a portal or a focus trap: it is a short list rendered in
 * flow directly under a sticky header, so the page behind it stays scrollable
 * and Escape plus a tap outside are enough to dismiss it.
 */
export function MobileNav({ items, className }: { items: MobileNavItem[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // A link inside the sheet navigates without unmounting the header, so the
  // sheet would otherwise stay open over the page you just asked for.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav-sheet"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border-subtle text-muted transition-colors hover:text-foreground"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>

      {open && (
        <>
          {/* Catches the tap that dismisses. Behind the sheet, over the page. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-[57px] z-40 cursor-default bg-background/60"
          />
          <div
            id="mobile-nav-sheet"
            className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
          >
            <nav className="flex flex-col p-1.5">
              {items
                .filter((i) => !i.primary)
                .map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                ))}
              {items
                .filter((i) => i.primary)
                .map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="mt-1.5 rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-primary-hover"
                  >
                    {item.label}
                  </Link>
                ))}
            </nav>
          </div>
        </>
      )}
    </div>
  )
}
