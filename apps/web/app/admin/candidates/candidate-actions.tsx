'use client'

import { useTransition } from 'react'
import { approveCandidate, suppressCandidate } from './actions'
import { buttonClass } from '@/components/ui/button'
import { ReasonButton } from '@/components/admin/reason-button'

export function CandidateActions({ candidateId, status }: { candidateId: string; status: string }) {
  const [approvePending, startApprove] = useTransition()

  if (status !== 'pending' && status !== 'suppressed') {
    return <span className="text-xs text-muted-2">{status}</span>
  }

  return (
    // Stop clicks bubbling to the ClickableRow, which would navigate to the
    // detail page mid-approve and make the button look like it did nothing.
    <div className="flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
      <button
        disabled={approvePending}
        onClick={(e) => { e.stopPropagation(); startApprove(() => { void approveCandidate(candidateId) }) }}
        // Filled, not a tint. `bg-rookie/20 text-rookie` is 4.51:1 in light
        // and drops under AA the moment it is hovered; a solid fill with the
        // page colour on it is 7.80:1 dark and 5.74:1 light, and it stays put.
        className={buttonClass({ variant: 'none', size: 'sm', className: 'bg-rookie text-background hover:opacity-90' })}
      >
        {approvePending ? '…' : 'Approve'}
      </button>
      {status === 'pending' && (
        <ReasonButton
          label="Suppress"
          confirmLabel="Reject"
          disabled={approvePending}
          onConfirm={(reason) => suppressCandidate(candidateId, reason)}
        />
      )}
    </div>
  )
}
