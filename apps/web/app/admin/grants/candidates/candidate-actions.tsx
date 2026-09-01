'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  attachGrantCandidate,
  markGrantCandidateDuplicate,
  reopenGrantCandidate,
  suppressGrantCandidate,
} from './actions'

/**
 * The four ways a candidate leaves the queue, plus a way back.
 *
 * "Publish" is a LINK, not a button. Everything else here is a one-click
 * decision, but publishing opens the editor at /admin/grants/candidates/<id>
 * where a person corrects the classifier's guesses before anything is written.
 * The classifier's output is a draft, never a fact, so there is deliberately no
 * one-click publish anywhere on this screen.
 */
export function GrantCandidateActions({
  candidateId,
  status,
  matchedGrantSlug,
}: {
  candidateId: string
  status: string
  matchedGrantSlug: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [grantRef, setGrantRef] = useState('')
  const [reason, setReason] = useState('')

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (res.error) setError(res.error)
      router.refresh()
    })
  }

  const decided = status === 'suppressed' || status === 'duplicate'

  return (
    <div className="flex flex-col items-end gap-1.5">
      {status !== 'published' && (
        <div className="flex gap-2">
          <Link
            href={`/admin/grants/candidates/${candidateId}`}
            className="rounded bg-primary/20 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/35"
          >
            Publish…
          </Link>
          {!decided && (
            <button
              disabled={pending || !reason.trim()}
              title={reason.trim() ? 'Suppress with this reason' : 'Type a reason first'}
              onClick={() => run(() => suppressGrantCandidate(candidateId, reason))}
              className="rounded bg-surface-3 px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
            >
              {pending ? '…' : 'Suppress'}
            </button>
          )}
        </div>
      )}

      {status === 'published' && matchedGrantSlug && (
        <span className="text-xs text-rookie">published as {matchedGrantSlug}</span>
      )}

      {status !== 'published' && (
        <>
          {/* One box feeds both "attach" and "duplicate": both answer the same
              question, which grant is this really about. Duplicate accepts an
              empty box because a candidate can duplicate another candidate that
              is not listed yet. */}
          <div className="flex gap-1">
            <input
              value={grantRef}
              onChange={(e) => setGrantRef(e.target.value)}
              placeholder="grant slug or id"
              className="w-40 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
            />
            <button
              disabled={pending || !grantRef.trim()}
              title="This page is more evidence for a grant we already list"
              onClick={() => run(() => attachGrantCandidate(candidateId, grantRef))}
              className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
            >
              Attach
            </button>
            <button
              disabled={pending}
              title="Same grant as something already here. Does not count against the source."
              onClick={() => run(() => markGrantCandidateDuplicate(candidateId, grantRef))}
              className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
            >
              Duplicate
            </button>
          </div>

          {!decided && (
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why suppressed (required)"
              className="w-64 rounded border border-border bg-surface px-2 py-1 text-[10px] text-foreground outline-none focus:border-primary"
            />
          )}
        </>
      )}

      {decided && (
        <button
          disabled={pending}
          onClick={() => run(() => reopenGrantCandidate(candidateId))}
          className="text-[10px] text-muted hover:text-foreground disabled:opacity-40"
        >
          Reopen
        </button>
      )}

      {error && <p className="max-w-[16rem] text-right text-[10px] text-frc">{error}</p>}
    </div>
  )
}
