'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { entityNoun } from './listing-labels'
import type { ListingEntityType } from '@the-tool-pit/db'

/**
 * Step back from a listing you manage.
 *
 * IT USED TO BE ON THE CARD, next to Edit, on /me/listings. A one-click
 * destructive action sitting beside the thing you actually came to press, on a
 * list of every listing you run. Nobody goes to that page to give one up. So it
 * lives here, at the bottom of the listing's own edit page, which is where a
 * destructive action belongs: past everything you might have come for, on the
 * page for the one listing it affects.
 *
 * IT ASKS FIRST, and it asks in the page rather than through window.confirm.
 * The native dialog is unstyled, says the site's hostname above the question,
 * and iOS will suppress it outright after a few. Closed, this is one quiet
 * button; open, it is the question and the two answers, and nothing is sent
 * until Leave is pressed a second time.
 *
 * The action reads the signed-in user from the session for a self-removal, so
 * no user id is held or posted here. It also refuses to leave a listing nobody
 * else owns, which is the case this panel cannot help with: the message says so
 * and the listing stays yours.
 */
export function LeaveListingPanel({
  entityType,
  entityId,
  leaveAction,
}: {
  entityType: ListingEntityType
  entityId: string
  leaveAction: (
    entityType: string,
    entityId: string,
    targetUserId: string,
  ) => Promise<{ error?: string; message?: string }>
}) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const noun = entityNoun(entityType).toLowerCase()

  function onLeave() {
    setErr(null)
    start(async () => {
      // '__self__' means "remove me", resolved from the session. See removeOwner.
      const res = await leaveAction(entityType, entityId, '__self__')
      if (res.error) {
        setErr(res.error)
        setAsking(false)
        return
      }
      router.push('/me/listings')
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-5">
      <h2 className="text-lg font-semibold text-foreground">Leave this listing</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        You stop managing it and lose edit access. The {noun} itself stays listed, and everything
        you have already changed stays as you left it.
      </p>

      {asking ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-foreground">
            Leave this {noun}? You will need to claim it again to get back in.
          </span>
          <button
            type="button"
            onClick={onLeave}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md bg-frc px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-frc/90 disabled:opacity-40"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {pending ? 'Leaving…' : 'Leave'}
          </button>
          <button
            type="button"
            onClick={() => setAsking(false)}
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setErr(null)
            setAsking(true)
          }}
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-frc/40 px-3 py-1.5 text-sm font-medium text-frc transition-colors hover:bg-frc/10"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Leave this {noun}
        </button>
      )}

      {err && (
        <p role="alert" className="mt-3 text-sm text-frc">
          {err}
        </p>
      )}
    </section>
  )
}
