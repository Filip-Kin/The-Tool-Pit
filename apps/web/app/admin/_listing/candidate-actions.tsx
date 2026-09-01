'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The ways a discovered lead leaves the queue, for both listing verticals.
 *
 * Off-season events and practice fields moderate identically, so the buttons
 * are one component and the two routes pass their own server actions in. The
 * copy differs only where the verticals genuinely differ, which is what a
 * reference to an existing row looks like.
 *
 * Accept writes a PENDING row, never a published one. The name sits in a box
 * because both target tables have a NOT NULL name and a connector that could
 * not read one leaves it blank rather than inventing it.
 */

type Decision = (candidateId: string, arg: string) => Promise<{ error?: string }>

export function ListingCandidateActions({
  candidateId,
  status,
  defaultName,
  matchedLabel,
  refPlaceholder,
  acceptedNote,
  accept,
  attach,
  suppress,
  markDuplicate,
  reopen,
}: {
  candidateId: string
  status: string
  /** Prefills the name box: the extracted name, or the page title behind it. */
  defaultName: string
  /** What this candidate ended up as, shown once it has been accepted or attached. */
  matchedLabel: string | null
  refPlaceholder: string
  /** One line telling the reviewer what accepting does not fill in. */
  acceptedNote: string
  accept: Decision
  attach: Decision
  suppress: Decision
  markDuplicate: Decision
  reopen: (candidateId: string) => Promise<{ error?: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(defaultName)
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

  const open = status === 'pending'
  const decided = status === 'suppressed' || status === 'duplicate'

  return (
    <div className="flex w-full flex-col gap-2">
      {open && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name for the listing"
              className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
            />
            <button
              disabled={pending || !name.trim()}
              title={name.trim() ? 'Create a pending row from this lead' : 'It needs a name first'}
              onClick={() => run(() => accept(candidateId, name))}
              className="rounded bg-primary/20 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/35 disabled:opacity-40"
            >
              {pending ? '…' : 'Accept into listing'}
            </button>
          </div>
          <p className="text-[10px] text-muted-2">{acceptedNote}</p>
        </>
      )}

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
