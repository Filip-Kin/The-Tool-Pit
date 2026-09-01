'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { runGrantSource, setGrantSourceCadence, setGrantSourceEnabled } from './actions'

/** Run, enable/disable and cadence for one grant_sources row. */
export function GrantSourceControls({
  sourceId,
  enabled,
  cadenceHours,
}: {
  sourceId: string
  enabled: boolean
  cadenceHours: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)
  const [cadence, setCadence] = useState(String(cadenceHours))

  function run(fn: () => Promise<{ error?: string }>, thenQueued = false) {
    setError(null)
    setQueued(false)
    start(async () => {
      const res = await fn()
      if (res.error) setError(res.error)
      else if (thenQueued) setQueued(true)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <button
          disabled={pending || !enabled}
          title={enabled ? 'Queue a discovery run for this source now' : 'Switched off. Enable it first.'}
          onClick={() => run(() => runGrantSource(sourceId), true)}
          className="rounded bg-primary/20 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/35 disabled:opacity-40"
        >
          {pending ? '…' : 'Run now'}
        </button>
        <button
          disabled={pending}
          onClick={() => run(() => setGrantSourceEnabled(sourceId, !enabled))}
          className="rounded border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          {enabled ? 'Switch off' : 'Switch on'}
        </button>
      </div>

      <div className="flex items-center gap-1">
        <input
          value={cadence}
          onChange={(e) => setCadence(e.target.value)}
          inputMode="numeric"
          className="w-16 rounded border border-border bg-surface px-2 py-1 text-right text-[10px] text-foreground outline-none focus:border-primary"
        />
        <span className="text-[10px] text-muted-2">hours</span>
        <button
          disabled={pending || cadence === String(cadenceHours)}
          onClick={() => run(() => setGrantSourceCadence(sourceId, Number(cadence)))}
          className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:text-foreground disabled:opacity-40"
        >
          Set
        </button>
      </div>

      {queued && <span className="text-[10px] text-rookie">Queued</span>}
      {error && <p className="max-w-[14rem] text-right text-[10px] text-frc">{error}</p>}
    </div>
  )
}
