'use client'

import { useRouter } from 'next/navigation'

/**
 * "← All grants". Going back in history keeps the list's scroll position and
 * filters; a fresh visitor with no history goes to the list itself.
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter()
  return (
    <a
      href={href}
      onClick={(e) => {
        if (typeof window === 'undefined') return
        const cameFromHere = document.referrer.startsWith(window.location.origin)
        if (window.history.length > 1 && cameFromHere) {
          e.preventDefault()
          router.back()
        }
      }}
      className="text-sm text-muted hover:text-foreground"
    >
      {children}
    </a>
  )
}
