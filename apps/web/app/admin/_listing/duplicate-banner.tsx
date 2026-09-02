'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

/**
 * "This looks like something already on the site."
 *
 * Nothing warned a moderator that a lead already existed, so duplicates were
 * caught by recognising a name: Mos Eisley and Wolverine were both filed again
 * over listings already published. Off-season names repeat across states, so
 * this is a prompt and not a block. It shows the listing this resembles, links
 * to it, and offers Attach, which turns the candidate into evidence for that
 * listing rather than a second copy. Accepting anyway is one scroll down.
 */
export function DuplicateBanner({
  candidateId,
  match,
  attach,
}: {
  candidateId: string
  match: { id: string; name: string; status: string; sim: number }
  attach: (candidateId: string, ref: string) => Promise<{ error?: string }>
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-stale/40 bg-stale/10 px-3 py-2 text-xs">
      <span className="text-foreground">
        Looks like{' '}
        <Link href={`/admin/event-listings`} className="font-medium text-stale underline-offset-2 hover:underline">
          {match.name}
        </Link>{' '}
        <span className="text-muted-2">
          ({match.status}, {Math.round(match.sim * 100)}% name match)
        </span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            setError(null)
            const res = await attach(candidateId, match.id)
            if (res.error) setError(res.error)
            router.refresh()
          })
        }
        className="rounded border border-stale/50 px-2 py-1 font-medium text-stale transition-colors hover:bg-stale/15 disabled:opacity-40"
      >
        {busy ? '…' : 'Attach to it instead'}
      </button>
      {error && <span className="text-frc">{error}</span>}
    </div>
  )
}
