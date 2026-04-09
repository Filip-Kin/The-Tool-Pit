'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
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
        <p className="text-sm text-red-400 rounded bg-red-500/10 px-3 py-2">{error}</p>
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
          className="self-start rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50"
        >
          {approvePending ? 'Publishing…' : 'Approve & Publish'}
        </button>
      )}

      {/* Suppress with reason */}
      {status !== 'suppressed' && (
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted font-medium">
            Rejection reason <span className="text-muted-2">(optional)</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. duplicate of X, spam, not FIRST-related…"
            className="input text-sm"
          />
          <button
            disabled={approvePending || suppressPending}
            onClick={() =>
              startSuppress(async () => {
                setError(null)
                await suppressCandidate(candidateId, reason || undefined)
                router.refresh()
              })
            }
            className="self-start rounded-md border border-red-600/40 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            {suppressPending ? 'Suppressing…' : 'Suppress'}
          </button>
        </div>
      )}
    </div>
  )
}
