'use client'

import { useTransition } from 'react'
import { rejectSubmission, requeueSubmission, markNeedsReview } from './actions'

export function SubmissionActions({ submissionId, status }: { submissionId: string; status: string }) {
  const [pending, startTransition] = useTransition()

  const btn = (label: string, action: () => Promise<void>, style: string) => (
    <button
      disabled={pending}
      onClick={() => startTransition(action)}
      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${style}`}
    >
      {pending ? '…' : label}
    </button>
  )

  if (status === 'pending' || status === 'needs_review') {
    return (
      <div className="flex gap-2 justify-end">
        {btn(
          'Re-queue',
          () => requeueSubmission(submissionId),
          'bg-[var(--color-primary)]/10 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20',
        )}
        {btn(
          'Reject',
          () => rejectSubmission(submissionId),
          'bg-[var(--color-surface-3)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]',
        )}
      </div>
    )
  }

  if (status === 'processing') {
    return (
      <div className="flex gap-2 justify-end">
        {btn(
          'Mark Review',
          () => markNeedsReview(submissionId),
          'bg-[var(--color-surface-3)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]',
        )}
      </div>
    )
  }

  if (status === 'rejected' || status === 'duplicate') {
    return (
      <div className="flex gap-2 justify-end">
        {btn(
          'Re-queue',
          () => requeueSubmission(submissionId),
          'bg-[var(--color-surface-3)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]',
        )}
      </div>
    )
  }

  return <span className="text-xs text-[var(--color-muted-2)]">{status}</span>
}
