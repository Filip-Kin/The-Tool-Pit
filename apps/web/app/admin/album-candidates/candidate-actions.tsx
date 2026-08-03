'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveAlbumCandidate, suppressAlbumCandidate, setAlbumEventMatch } from './actions'

export function AlbumCandidateActions({
  candidateId,
  status,
  hasEvent,
  targetEventCode,
  targetEventYear,
  matchedEventKey,
}: {
  candidateId: string
  status: string
  hasEvent: boolean
  targetEventCode: string | null
  targetEventYear: number | null
  matchedEventKey: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Pre-fill the full TBA key (year + code) - matched/published show the current
  // event so it can be corrected; unmatched show the connector's best guess.
  const [code, setCode] = useState(
    matchedEventKey ?? (targetEventCode ? `${targetEventYear ?? ''}${targetEventCode}` : ''),
  )

  if (status === 'duplicate') {
    return <span className="text-xs text-muted-2">duplicate</span>
  }

  function run(fn: () => Promise<{ error?: string } | void>) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (res && 'error' in res && res.error) setError(res.error)
      router.refresh()
    })
  }

  const canModerate = status === 'pending' || status === 'matched' || status === 'suppressed'

  return (
    <div className="flex flex-col items-end gap-1.5">
      {canModerate && (
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
      )}
      {status === 'published' && <span className="text-xs text-official">published</span>}

      <div className="flex gap-1">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder=""
          className="w-28 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        />
        <button
          disabled={pending || !code.trim()}
          onClick={() => run(() => setAlbumEventMatch(candidateId, code))}
          className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
        >
          {hasEvent ? 'Change event' : 'Set event'}
        </button>
      </div>
      {error && <p className="max-w-[12rem] text-right text-[10px] text-frc">{error}</p>}
    </div>
  )
}
