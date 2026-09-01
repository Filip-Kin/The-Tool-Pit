'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellRing } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useSession } from '@/components/auth/session-provider'
import { SignInDialog } from '@/components/auth/sign-in-dialog'

/**
 * Watch a grant: a reminder before the deadline, and a ping when the listing
 * itself changes.
 *
 * The endpoint this calls (POST and DELETE /api/grants/<id>/watch) is built
 * separately from this button, so a 404 is treated as "reminders are not
 * switched on yet" rather than as a failure. The control then says so and
 * stops trying, which is honest and leaves the rest of the page working. It
 * never silently pretends the watch was saved.
 */
export function WatchButton({
  grantId,
  initialWatching,
  hasDeadline,
}: {
  grantId: string
  initialWatching: boolean
  /**
   * False for a rolling grant or one with no confirmed dates. The watch is
   * still worth having (it covers listing changes), and saying which of the
   * two you get avoids promising a reminder we cannot send.
   */
  hasDeadline: boolean
}) {
  const { user } = useSession()
  const [watching, setWatching] = useState(initialWatching)
  const [busy, setBusy] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Set when a signed-out person clicks, replayed once they are signed in, so
  // the click they made is the click that happens.
  const pendingWatch = useRef<boolean | null>(null)

  const send = useCallback(
    async (next: boolean) => {
      const previous = watching
      setWatching(next) // optimistic
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(`/api/grants/${grantId}/watch`, {
          method: next ? 'POST' : 'DELETE',
          headers: { 'content-type': 'application/json' },
        })
        if (res.status === 404) {
          setWatching(previous)
          setUnavailable(true)
          return
        }
        if (res.status === 401) {
          // The session can expire between page load and click.
          pendingWatch.current = next
          setWatching(previous)
          setDialogOpen(true)
          return
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Request failed (${res.status})`)
        }
      } catch (err) {
        setWatching(previous)
        setError(err instanceof Error ? err.message : 'Could not save that. Try again.')
      } finally {
        setBusy(false)
      }
    },
    [grantId, watching],
  )

  useEffect(() => {
    if (user && pendingWatch.current !== null) {
      const next = pendingWatch.current
      pendingWatch.current = null
      void send(next)
    }
  }, [user, send])

  function onClick() {
    if (unavailable) return
    if (!user) {
      pendingWatch.current = !watching
      setDialogOpen(true)
      return
    }
    void send(!watching)
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy || unavailable}
        aria-pressed={watching}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60',
          watching
            ? 'border-primary bg-primary/15 text-primary'
            : 'border-border bg-surface text-foreground hover:bg-surface-2',
          error && 'border-frc/60 text-frc',
        )}
      >
        {watching ? <BellRing className="h-4 w-4" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
        {watching ? 'Watching' : 'Watch this grant'}
      </button>

      {unavailable && (
        <span className="text-xs text-muted-2">Reminders are not switched on yet. Nothing was saved.</span>
      )}
      {error && <span className="text-xs text-frc">{error}</span>}
      {!unavailable && !error && (
        <span className="text-xs text-muted-2">
          {hasDeadline
            ? 'Reminders 30, 14 and 3 days before the deadline, plus a ping if the listing changes.'
            : 'No deadline to remind you about, so this pings you when the listing changes.'}
        </span>
      )}

      <SignInDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reason="Sign in to get a reminder before this deadline"
      />
    </div>
  )
}
