'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The ways a lead leaves the queue OTHER than being accepted.
 *
 * Accepting lives in CandidateEditor, because accepting now means correcting
 * the values first and then publishing, and that needs the whole record on
 * screen rather than one name box. What is left here is the three ways a lead
 * leaves without becoming a listing of its own: attach it to something we
 * already have, mark it a duplicate, or suppress it.
 *
 * Off-season events and practice fields moderate identically, so this is one
 * component and the two routes pass their own server actions in.
 */

type Decision = (candidateId: string, arg: string) => Promise<{ error?: string }>

export function ListingCandidateActions({
  candidateId,
  status,
  matchedLabel,
  refPlaceholder,
  attach,
  suppress,
  markDuplicate,
  reopen,
}: {
  candidateId: string
  status: string
  /** What this candidate ended up as, shown once it has been accepted or attached. */
  matchedLabel: string | null
  refPlaceholder: string
  attach: Decision
  suppress: Decision
  markDuplicate: Decision
  reopen: (candidateId: string) => Promise<{ error?: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [ref, setRef] = useState('')
  const [reason, setReason] = useState('')

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (res.error) setError(res.error)
      router.refresh()
    })
  }

  // `open` was only used by the accept block, which now lives in CandidateEditor.
  const decided = status === 'suppressed' || status === 'duplicate'

  return (
    <div className="flex w-full flex-col gap-2">
      {matchedLabel && <p className="text-xs text-rookie">{matchedLabel}</p>}

      {status !== 'published' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder={refPlaceholder}
              className="w-44 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
            />
            <button
              disabled={pending || !ref.trim()}
              title="This page is more evidence for something we already list"
              onClick={() => run(() => attach(candidateId, ref))}
              className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
            >
              Attach
            </button>
            <button
              disabled={pending}
              title="Same thing as something already here. Does not count against the source."
              onClick={() => run(() => markDuplicate(candidateId, ref))}
              className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
            >
              Duplicate
            </button>
          </div>

          {!decided && (
            <div className="flex flex-wrap gap-1.5">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why suppressed (required)"
                className="w-56 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
              />
              <button
                disabled={pending || !reason.trim()}
                title={reason.trim() ? 'Suppress with this reason' : 'Type a reason first'}
                onClick={() => run(() => suppress(candidateId, reason))}
                className="rounded bg-surface-3 px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
              >
                Suppress
              </button>
            </div>
          )}
        </>
      )}

      {decided && (
        <button
          disabled={pending}
          onClick={() => run(() => reopen(candidateId))}
          className="self-start text-[10px] text-muted hover:text-foreground disabled:opacity-40"
        >
          Reopen
        </button>
      )}

      {error && <p className="text-[10px] text-frc">{error}</p>}
    </div>
  )
}
