'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CandidateMergeDialog, type MergeField } from './candidate-merge-dialog'

/**
 * "This looks like something already on the site."
 *
 * Nothing warned a moderator that a lead already existed, so duplicates were
 * caught by recognising a name: Mos Eisley and Wolverine were both filed again
 * over listings already published. Off-season names repeat across states, so
 * this is a prompt and not a block. It shows the listing this resembles, links
 * to it, and offers Attach, which opens the merge dialog: what the candidate
 * found, next to what the listing already has, field by field. Accepting the
 * candidate as a listing of its own is still one scroll down.
 */
export function DuplicateBanner({
  candidateId,
  match,
  compare,
  applyMerge,
}: {
  candidateId: string
  match: { id: string; name: string; status: string; sim: number }
  compare: (candidateId: string, listingRef: string) => Promise<{ error?: string; listingName?: string; fields?: MergeField[] }>
  applyMerge: (candidateId: string, listingId: string, chosen: Record<string, string>) => Promise<{ error?: string }>
}) {
  const [open, setOpen] = useState(false)

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
        onClick={() => setOpen(true)}
        className="rounded border border-stale/50 px-2 py-1 font-medium text-stale transition-colors hover:bg-stale/15"
      >
        Attach to it instead
      </button>

      {open && (
        <CandidateMergeDialog
          candidateId={candidateId}
          listingRef={match.id}
          onClose={() => setOpen(false)}
          compare={compare}
          apply={applyMerge}
        />
      )}
    </div>
  )
}
