'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveAlbumCandidate, suppressAlbumCandidate, setAlbumEventMatch } from './actions'

export function AlbumCandidateActions({
  candidateId,
  status,
  hasEvent,
  targetEventCode,
}: {
  candidateId: string
  status: string
  hasEvent: boolean
  targetEventCode: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState(targetEventCode ?? '')

  if (status === 'published' || status === 'duplicate') {
    return <span className="text-xs text-muted-2">{status}</span>
  }

  function run(fn: () => Promise<{ error?: string } | void>) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (res && 'error' in res && res.error) setError(res.error)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <button
          disabled={pending || !hasEvent}
          title={hasEvent ? 'Publish this album' : 'Set an event first'}
          onClick={() => run(() => approveAlbumCandidate(candidateId))}
          className="rounded bg-green-700/20 px-2.5 py-1 text-xs font-medium text-green-400 hover:bg-green-700/40 transition-colors disabled:opacity-40"
        >
          {pending ? '…' : 'Approve'}
        </button>
        {status !== 'suppressed' && (
          <button
            disabled={pending}
            onClick={() => run(() => suppressAlbumCandidate(candidateId))}
            className="rounded bg-surface-3 px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground transition-colors disabled:opacity-40"
          >
            {pending ? '…' : 'Suppress'}
          </button>
        )}
      </div>
      {!hasEvent && (
        <div className="flex gap-1">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="event code"
            className="w-24 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          />
          <button
            disabled={pending || !code.trim()}
            onClick={() => run(() => setAlbumEventMatch(candidateId, code))}
            className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
          >
            Set event
          </button>
        </div>
      )}
      {error && <p className="max-w-[12rem] text-right text-[10px] text-frc">{error}</p>}
    </div>
  )
}
