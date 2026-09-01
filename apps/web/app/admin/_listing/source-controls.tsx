'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Source controls for both listing verticals: run, enable, cadence, and the
 * form that creates a source row in the first place.
 *
 * The worker treats a source row as optional, so a vertical with no rows still
 * crawls, on the connector's built-in settings, with no off switch. Creating a
 * row is how that off switch comes into existence, which is why the form is on
 * this screen rather than in a seed script.
 */

function useRun() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  function run(fn: () => Promise<{ error?: string }>, okMessage?: string) {
    setError(null)
    setDone(null)
    start(async () => {
      const res = await fn()
      if (res.error) setError(res.error)
      else if (okMessage) setDone(okMessage)
      router.refresh()
    })
  }

  return { run, pending, error, done }
}

export function ListingSourceControls({
  sourceId,
  enabled,
  cadenceHours,
  runnable,
  run: runSource,
  setEnabled,
  setCadence,
}: {
  sourceId: string
  enabled: boolean
  cadenceHours: number
  /** False for the seed and admin kinds, which no connector reads. */
  runnable: boolean
  run: (sourceId: string) => Promise<{ error?: string }>
  setEnabled: (sourceId: string, enabled: boolean) => Promise<{ error?: string }>
  setCadence: (sourceId: string, cadenceHours: number) => Promise<{ error?: string }>
}) {
  const { run, pending, error, done } = useRun()
  const [cadence, setCadenceInput] = useState(String(cadenceHours))

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <button
          disabled={pending || !enabled || !runnable}
          title={
            !runnable
              ? 'No connector reads this kind of row'
              : enabled
                ? 'Queue a discovery run for this source now'
                : 'Switched off. Enable it first.'
          }
          onClick={() => run(() => runSource(sourceId), 'Queued')}
          className="rounded bg-primary/20 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/35 disabled:opacity-40"
        >
          {pending ? '…' : 'Run now'}
        </button>
        <button
          disabled={pending}
          onClick={() => run(() => setEnabled(sourceId, !enabled))}
          className="rounded border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          {enabled ? 'Switch off' : 'Switch on'}
        </button>
      </div>

      <div className="flex items-center gap-1">
        <input
          value={cadence}
          onChange={(e) => setCadenceInput(e.target.value)}
          inputMode="numeric"
          className="w-16 rounded border border-border bg-surface px-2 py-1 text-right text-[10px] text-foreground outline-none focus:border-primary"
        />
        <span className="text-[10px] text-muted-2">hours</span>
        <button
          disabled={pending || cadence === String(cadenceHours)}
          onClick={() => run(() => setCadence(sourceId, Number(cadence)))}
          className="rounded border border-border px-2 py-1 text-[10px] text-muted hover:text-foreground disabled:opacity-40"
        >
          Set
        </button>
      </div>

      {done && <span className="text-[10px] text-rookie">{done}</span>}
      {error && <p className="max-w-[14rem] text-right text-[10px] text-frc">{error}</p>}
    </div>
  )
}

/** Run a connector directly, which is the only way in when it has no source row. */
export function ConnectorRunButtons({
  connectors,
  run: runConnector,
}: {
  connectors: { connector: string; label: string; description: string }[]
  run: (connector: string) => Promise<{ error?: string }>
}) {
  const { run, pending, error, done } = useRun()
  const [last, setLast] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        {connectors.map((c) => (
          <div key={c.connector} className="flex max-w-xs flex-col gap-1">
            <button
              disabled={pending}
              onClick={() => {
                setLast(c.connector)
                run(() => runConnector(c.connector), 'Queued')
              }}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {pending && last === c.connector ? 'Queuing…' : c.label}
            </button>
            <p className="text-[10px] text-muted-2">{c.description}</p>
            {done && last === c.connector && <p className="text-[10px] text-rookie">{done}</p>}
          </div>
        ))}
      </div>
      {error && <p className="text-[10px] text-frc">{error}</p>}
    </div>
  )
}

export function NewSourceForm({
  kinds,
  defaultCadence,
  create,
}: {
  kinds: readonly string[]
  defaultCadence: number
  create: (input: { kind: string; label: string; target: string; cadenceHours: number; notes?: string }) => Promise<{ error?: string }>
}) {
  const { run, pending, error, done } = useRun()
  const [kind, setKind] = useState(kinds[0] ?? '')
  const [label, setLabel] = useState('')
  const [target, setTarget] = useState('')
  const [cadence, setCadence] = useState(String(defaultCadence))
  const [notes, setNotes] = useState('')

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-foreground">Add a source</h2>
      <p className="text-[10px] text-muted-2">
        The worker finds a source by its kind. One row per kind, and that row is where the off switch
        and the cadence live.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label"
          className="w-40 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        />
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Target: page, endpoint or query"
          className="w-72 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        />
        <div className="flex items-center gap-1">
          <input
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            inputMode="numeric"
            className="w-16 rounded border border-border bg-surface px-2 py-1 text-right text-xs text-foreground outline-none focus:border-primary"
          />
          <span className="text-[10px] text-muted-2">hours</span>
        </div>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="w-56 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        />
        <button
          disabled={pending || !label.trim() || !target.trim()}
          onClick={() =>
            run(
              () => create({ kind, label, target, cadenceHours: Number(cadence), notes }),
              'Added',
            )
          }
          className="rounded bg-primary/20 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/35 disabled:opacity-40"
        >
          {pending ? '…' : 'Add'}
        </button>
      </div>
      {done && <p className="text-[10px] text-rookie">{done}</p>}
      {error && <p className="text-[10px] text-frc">{error}</p>}
    </div>
  )
}
