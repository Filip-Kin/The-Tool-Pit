'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Attach a candidate, field by field.
 *
 * Attach used to be silent: it linked the candidate as evidence and left the
 * listing exactly as it was. That is right when the listing already has
 * everything and the candidate adds nothing, and it is the wrong default the
 * moment the candidate found something newer or something missing. Neither
 * "always keep the listing" nor "always take the candidate" is safe on its
 * own, so this shows both values, per field, and a person picks.
 *
 * Fields that agree are not shown as a decision, only listed, so the choices
 * that actually matter are not buried under twelve rows saying "same".
 */

export interface MergeField {
  key: string
  label: string
  existing: string | number | boolean | null
  detected: string | number | boolean | null
  differs: boolean
}

function display(v: string | number | boolean | null): string {
  if (v === null) return '-'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return String(v)
}

export function CandidateMergeDialog({
  candidateId,
  listingRef,
  onClose,
  compare,
  apply,
}: {
  candidateId: string
  listingRef: string
  onClose: () => void
  compare: (candidateId: string, listingRef: string) => Promise<{ error?: string; listingName?: string; fields?: MergeField[] }>
  apply: (candidateId: string, listingId: string, chosen: Record<string, string>) => Promise<{ error?: string }>
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [listingName, setListingName] = useState('')
  const [listingId, setListingId] = useState('')
  const [fields, setFields] = useState<MergeField[]>([])
  // key -> 'existing' | 'detected'
  const [choice, setChoice] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    compare(candidateId, listingRef).then((res) => {
      if (cancelled) return
      if (res.error) {
        setError(res.error)
      } else {
        setListingName(res.listingName ?? '')
        setListingId(listingRef)
        const rows = res.fields ?? []
        setFields(rows)
        // Existing wins by default on a disagreement: it is what a person
        // already vouched for, or what is live on the map right now. A blank
        // existing defaults to the detected value, since there is nothing to
        // protect.
        const defaults: Record<string, string> = {}
        for (const f of rows) defaults[f.key] = f.existing === null ? 'detected' : 'existing'
        setChoice(defaults)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [candidateId, listingRef])

  function setAll(value: 'existing' | 'detected') {
    setChoice((c) => {
      const next = { ...c }
      for (const f of fields) next[f.key] = value
      return next
    })
  }

  function submit() {
    start(async () => {
      const res = await apply(candidateId, listingId, choice)
      if (res.error) setError(res.error)
      else {
        router.refresh()
        onClose()
      }
    })
  }

  const disagreements = fields.filter((f) => f.differs)
  const agreements = fields.filter((f) => !f.differs)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Attach to {listingName || 'this listing'}</p>
            <p className="text-xs text-muted-2">Per field: keep what is live, or take what this candidate found.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
          >
            Close
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-muted">Reading both sides…</p>
          ) : error ? (
            <p className="text-sm text-frc">{error}</p>
          ) : fields.length === 0 ? (
            <p className="text-sm text-muted">This candidate has nothing the listing does not already have.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {disagreements.length > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-2">
                    {disagreements.length} to decide
                  </p>
                  <div className="flex gap-1.5 text-xs">
                    <button type="button" onClick={() => setAll('existing')} className="rounded border border-border px-2 py-1 text-muted hover:text-foreground">
                      Keep all existing
                    </button>
                    <button type="button" onClick={() => setAll('detected')} className="rounded border border-border px-2 py-1 text-muted hover:text-foreground">
                      Take all detected
                    </button>
                  </div>
                </div>
              )}

              {disagreements.map((f) => (
                <fieldset key={f.key} className="flex flex-col gap-1.5 rounded-md border border-stale/40 bg-stale/5 p-3">
                  <legend className="px-1 text-xs font-medium text-foreground">{f.label}</legend>
                  <label className="flex items-start gap-2 rounded p-1.5 text-xs hover:bg-surface-2">
                    <input
                      type="radio"
                      name={`field-${f.key}`}
                      checked={choice[f.key] === 'existing'}
                      onChange={() => setChoice((c) => ({ ...c, [f.key]: 'existing' }))}
                      className="mt-0.5 accent-primary"
                    />
                    <span>
                      <span className="text-muted-2">Keep: </span>
                      <span className={f.existing === null ? 'italic text-muted-2' : 'text-foreground'}>
                        {f.existing === null ? 'blank' : display(f.existing)}
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 rounded p-1.5 text-xs hover:bg-surface-2">
                    <input
                      type="radio"
                      name={`field-${f.key}`}
                      checked={choice[f.key] === 'detected'}
                      onChange={() => setChoice((c) => ({ ...c, [f.key]: 'detected' }))}
                      className="mt-0.5 accent-primary"
                    />
                    <span>
                      <span className="text-muted-2">Take: </span>
                      <span className="text-foreground">{display(f.detected)}</span>
                    </span>
                  </label>
                </fieldset>
              ))}

              {agreements.length > 0 && (
                <details className="text-xs text-muted-2">
                  <summary className="cursor-pointer select-none">
                    {agreements.length} more field{agreements.length === 1 ? '' : 's'} already agree
                  </summary>
                  <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
                    {agreements.map((f) => (
                      <div key={f.key} className="contents">
                        <dt>{f.label}</dt>
                        <dd className="text-foreground">{display(f.existing)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || loading || !!error}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            {busy ? 'Attaching…' : 'Apply and attach'}
          </button>
        </div>
      </div>
    </div>
  )
}
