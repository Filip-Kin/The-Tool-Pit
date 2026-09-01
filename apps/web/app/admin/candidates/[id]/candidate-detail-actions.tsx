'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buttonClass } from '@/components/ui/button'
import { approveCandidate, suppressCandidate } from '../actions'

export function CandidateDetailActions({
  candidateId,
  status,
}: {
  candidateId: string
  status: string
}) {
  const router = useRouter()
  const [approvePending, startApprove] = useTransition()
  const [suppressPending, startSuppress] = useTransition()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (status === 'published') {
    return <p className="text-sm text-muted">This candidate has already been published.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="text-sm text-frc rounded bg-frc/10 px-3 py-2">{error}</p>
      )}

      {/* Approval */}
      {(status === 'pending' || status === 'suppressed') && (
        <button
          disabled={approvePending || suppressPending}
          onClick={() =>
            startApprove(async () => {
              setError(null)
              const result = await approveCandidate(candidateId)
              if (result.error) {
                setError(result.error)
              } else {
                router.refresh()
              }
            })
          }
          // text-background, not text-white: white on this green is 2.54:1
          // under the dark theme, which is the theme this screen was built in.
          className={buttonClass({ variant: 'none', className: 'self-start bg-rookie text-background hover:opacity-90' })}
        >
          {approvePending ? 'Publishing…' : 'Approve & Publish'}
        </button>
      )}

      {/* Suppress with reason */}
      {status !== 'suppressed' && (
        <div className="flex flex-col gap-2">
          {/* Required, not decoration: this text is the body of the email the
              submitter gets, and a rejection with no reason is the thing people
              write back about. */}
          <label className="text-xs text-muted font-medium">
            Rejection reason <span className="text-muted-2">(required)</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. duplicate of X, spam, not FIRST-related…"
            className="input text-sm"
          />
          <button
            disabled={approvePending || suppressPending || !reason.trim()}
            title={reason.trim() ? 'Suppress with this reason' : 'Type a reason first'}
            onClick={() =>
              startSuppress(async () => {
                setError(null)
                const result = await suppressCandidate(candidateId, reason)
                if (result.error) {
                  setError(result.error)
                  return
                }
                router.refresh()
              })
            }
            // The same outline the ReasonButton uses for its Reject, because
            // this button sends the same email.
            className={buttonClass({ variant: 'none', className: 'self-start border border-frc/40 text-frc hover:bg-frc/10' })}
          >
            {suppressPending ? 'Suppressing…' : 'Suppress'}
          </button>
        </div>
      )}
    </div>
  )
}
