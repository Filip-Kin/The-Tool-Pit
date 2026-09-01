'use client'

import { useTransition } from 'react'
import { approveCandidate, suppressCandidate } from './actions'
import { ReasonButton } from '@/components/admin/reason-button'

export function CandidateActions({ candidateId, status }: { candidateId: string; status: string }) {
  const [approvePending, startApprove] = useTransition()

  if (status !== 'pending' && status !== 'suppressed') {
    return <span className="text-xs text-muted-2">{status}</span>
  }

  return (
    <div className="flex gap-2 justify-end">
      <button
        disabled={approvePending}
        onClick={() => startApprove(() => { void approveCandidate(candidateId) })}
        className="rounded bg-green-700/20 px-2.5 py-1 text-xs font-medium text-green-400 hover:bg-green-700/40 transition-colors disabled:opacity-40"
      >
        {approvePending ? '…' : 'Approve'}
      </button>
      {status === 'pending' && (
        <ReasonButton
          label="Suppress"
          confirmLabel="Reject"
          disabled={approvePending}
          className="rounded bg-surface-3 px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground transition-colors disabled:opacity-40"
          onConfirm={(reason) => suppressCandidate(candidateId, reason)}
        />
      )}
    </div>
  )
}
