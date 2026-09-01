'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useSession } from '@/components/auth/session-provider'
import { SignInDialog } from '@/components/auth/sign-in-dialog'

/**
 * One control for a grant, where there used to be two.
 *
 * The page carried a "Save" heart and a "Watch this grant" bell side by side,
 * styled differently, and a reader could not tell them apart. They were not the
 * same thing underneath: Save put the grant on your home page, Watch signed you
 * up for a reminder before the deadline. But nobody saves a grant and wants no
 * reminder, and nobody wants reminders on a grant they have not saved, so the
 * split was ours and not the reader's.
 *
 * Saving now does both. The line under the button says what you get, which is
 * the part the two buttons never managed to say between them.
 *
 * The watch endpoint may not be deployed yet, so a 404 there is not a failure:
 * the grant is still saved and the note says reminders are not on. The favourite
 * is what must not silently fail, because that is the part the button claims.
 */
export function SaveGrantButton({
  grantId,
  initialSaved,
  initialWatching,
  hasDeadline,
}: {
  grantId: string
  /** Resolved server-side so the first paint is already correct. */
  initialSaved: boolean
  initialWatching: boolean
  /**
   * False for a rolling grant or one with no confirmed dates. Saving is still
   * worth it (it covers listing changes), and saying which of the two you get
   * avoids promising a reminder we cannot send.
   */
  hasDeadline: boolean
}) {
  const { user, loading } = useSession()
  const [saved, setSaved] = useState(initialSaved || initialWatching)
  const [busy, setBusy] = useState(false)
  const [remindersOff, setRemindersOff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Set when a signed-out person clicks, replayed once they are signed in, so
  // the click they made is the click that happens.
  const pendingSave = useRef<boolean | null>(null)

  const send = useCallback(
    async (next: boolean) => {
      const previous = saved
      setSaved(next) // optimistic
      setBusy(true)
      setError(null)
      const method = next ? 'POST' : 'DELETE'
      try {
        const favorite = await fetch('/api/favorites', {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityType: 'grant', entityId: grantId }),
        })

        // The session can expire between page load and click, so a 401 is a
        // sign-in prompt rather than an error message.
        if (favorite.status === 401) {
          pendingSave.current = next
          setSaved(previous)
          setDialogOpen(true)
          return
        }
        if (!favorite.ok) {
          const body = (await favorite.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Request failed (${favorite.status})`)
        }

        // The reminder half. Its absence must not roll back the save.
        const watch = await fetch(`/api/grants/${grantId}/watch`, {
          method,
          headers: { 'content-type': 'application/json' },
        })
        setRemindersOff(watch.status === 404)
      } catch (err) {
        setSaved(previous) // roll back
        setError(err instanceof Error ? err.message : 'Could not save that. Try again.')
      } finally {
        setBusy(false)
      }
    },
    [grantId, saved],
  )

  // Finish what the person clicked before they were asked to sign in.
  useEffect(() => {
    if (user && pendingSave.current !== null) {
      const next = pendingSave.current
      pendingSave.current = null
      void send(next)
    }
  }, [user, send])

  function onClick() {
    if (!user) {
      pendingSave.current = true
      setDialogOpen(true)
      return
    }
    void send(!saved)
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        // Disabled only while a request is in flight. Never while the session
        // is still loading: a signed-out click is a useful click.
        disabled={busy}
        aria-pressed={saved}
        aria-busy={busy || loading}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60',
          saved
            ? 'border-primary bg-primary/15 text-primary'
            : 'border-border bg-surface text-foreground hover:bg-surface-2',
          error && 'border-frc/60 text-frc',
        )}
      >
        <Bookmark className={cn('h-4 w-4', saved && 'fill-current')} aria-hidden />
        {saved ? 'Saved' : 'Save this grant'}
      </button>

      <p className="text-xs text-muted-2">
        {error
          ? error
          : saved
            ? remindersOff
              ? 'On your home page. Reminders are not switched on yet.'
              : hasDeadline
                ? 'On your home page. We will email you before the deadline.'
                : 'On your home page. We will email you if the listing changes.'
            : hasDeadline
              ? 'Keeps it on your home page and emails you before the deadline.'
              : 'Keeps it on your home page and emails you if the listing changes.'}
      </p>

      <SignInDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reason="Sign in to save this grant and get a reminder before the deadline"
      />
    </div>
  )
}
