'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useSession } from './session-provider'
import { SignInDialog } from './sign-in-dialog'
import type { FavoriteEntityType } from '@the-tool-pit/db'

/**
 * Save / unsave any of the four verticals' things.
 *
 * Sized to sit in a card corner, so it is icon-only by default and stops its
 * click from reaching the card link it is layered over. The toggle is
 * optimistic and rolls back if the request fails, because the alternative is a
 * heart that does nothing for a second on a phone on venue wifi.
 *
 * Signed out, it opens the sign-in dialog with a reason and remembers the
 * intent, so the thing the person clicked is actually saved once they are
 * signed in. Silently doing nothing is how people conclude the feature is
 * broken.
 */
export function FavoriteButton({
  entityType,
  entityId,
  initialFavorited,
  reason = 'Sign in to save this to your home page',
  label,
  className,
}: {
  entityType: FavoriteEntityType
  entityId: string
  /** Resolved server-side by isFavorited() so the first paint is already correct. */
  initialFavorited: boolean
  /** Line shown in the sign-in dialog explaining why we are asking now. */
  reason?: string
  /** Optional visible text next to the icon, for detail pages rather than cards. */
  label?: string
  className?: string
}) {
  const { user, loading } = useSession()
  const [favorited, setFavorited] = useState(initialFavorited)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Set when a signed-out person clicks, consumed once they sign in.
  const pendingSave = useRef(false)

  const send = useCallback(
    async (next: boolean) => {
      const previous = favorited
      setFavorited(next) // optimistic
      setBusy(true)
      setError(null)
      try {
        const res = await fetch('/api/favorites', {
          method: next ? 'POST' : 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityType, entityId }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}) as { error?: string; code?: string })
          // The session can expire between page load and click, so a 401 here
          // is a sign-in prompt, not an error message.
          if (res.status === 401) {
            pendingSave.current = next
            setFavorited(previous)
            setDialogOpen(true)
            return
          }
          throw new Error(body.error ?? `Request failed (${res.status})`)
        }
      } catch (err) {
        setFavorited(previous) // roll back
        setError(err instanceof Error ? err.message : 'Could not save that. Try again.')
      } finally {
        setBusy(false)
      }
    },
    [entityId, entityType, favorited],
  )

  // Finish what the person clicked before they were asked to sign in.
  useEffect(() => {
    if (user && pendingSave.current) {
      const next = pendingSave.current
      pendingSave.current = false
      void send(next)
    }
  }, [user, send])

  function onClick(e: React.MouseEvent) {
    // Cards wrap the whole tile in a link, so without this the click navigates
    // away instead of saving.
    e.preventDefault()
    e.stopPropagation()

    if (!user) {
      pendingSave.current = true
      setDialogOpen(true)
      return
    }
    void send(!favorited)
  }

  const title = error ?? (favorited ? 'Saved. Click to remove' : 'Save this')

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        // Disabled only while a request is in flight. Never while the session
        // is still loading: a signed-out click is a useful click.
        disabled={busy}
        aria-pressed={favorited}
        aria-label={favorited ? 'Remove from saved' : 'Save'}
        aria-busy={busy || loading}
        title={title}
        className={cn(
          // rounded-md, not rounded-full. This sits directly beside the upvote
          // on every tool card, and the two were a circle and a rounded square
          // doing the same kind of job. components/ui/button.tsx is rounded-md,
          // so that is what the app means by a control.
          'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border-subtle bg-background/80 p-1.5 text-muted backdrop-blur transition-colors',
          'hover:text-foreground disabled:opacity-50',
          favorited && 'text-primary hover:text-primary',
          error && 'border-frc/60 text-frc',
          label && 'px-2.5 py-1 text-sm',
          className,
        )}
      >
        <Heart className={cn('h-4 w-4', favorited && 'fill-current')} aria-hidden />
        {label && <span>{favorited ? 'Saved' : label}</span>}
      </button>

      <SignInDialog open={dialogOpen} onOpenChange={setDialogOpen} reason={reason} />
    </>
  )
}
