'use client'

import { useTransition } from 'react'
import { approveCandidate, suppressCandidate } from './actions'

export function CandidateActions({ candidateId, status }: { candidateId: string; status: string }) {
  const [approvePending, startApprove] = useTransition()
  const [suppressPending, startSuppress] = useTransition()

  if (status !== 'pending') {
    return <span className="text-xs text-[var(--color-muted-2)]">{status}</span>
  }

  return (
    <div className="flex gap-2 justify-end">
      <button
        disabled={approvePending || suppressPending}
        onClick={() => startApprove(() => approveCandidate(candidateId))}
        className="rounded bg-green-700/20 px-2.5 py-1 text-xs font-medium text-green-400 hover:bg-green-700/40 transition-colors disabled:opacity-40"
      >
        {approvePending ? '…' : 'Approve'}
      </button>
      <button
        disabled={approvePending || suppressPending}
        onClick={() => startSuppress(() => suppressCandidate(candidateId))}
        className="rounded bg-[var(--color-surface-3)] px-2.5 py-1 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors disabled:opacity-40"
      >
        {suppressPending ? '…' : 'Suppress'}
      </button>
    </div>
  )
}
