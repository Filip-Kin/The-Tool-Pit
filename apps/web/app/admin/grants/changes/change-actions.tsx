'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { applyGrantChange, dismissGrantChange, reopenGrantChange } from './actions'

/**
 * Apply / dismiss for one filed change.
 *
 * Applying is deliberately awkward for a deadline-class change: the tickbox
 * has to be set, and the browser then asks again with the new value spelled
 * out. Applying is the only route a scraped date has onto a public listing, so
 * it should never be something a hand does on the way past. The server action
 * re-checks the tickbox, so this is a speed bump rather than the actual guard.
 */
export function GrantChangeActions({
  changeId,
  status,
  isDeadline,
  fieldLabel,
  newValueText,
}: {
  changeId: string
  status: string
  isDeadline: boolean
  fieldLabel: string
  newValueText: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [note, setNote] = useState('')

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (res.error) setError(res.error)
      router.refresh()
    })
  }

  function onApply() {
    if (isDeadline && !confirm(`Set ${fieldLabel} to:\n\n${newValueText}\n\nThis goes live on the public listing.`)) {
      return
    }
    run(() => applyGrantChange(changeId, checked || !isDeadline))
  }

  if (status !== 'pending') {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className={`text-xs ${status === 'applied' ? 'text-rookie' : 'text-muted-2'}`}>{status}</span>
        {status === 'dismissed' && (
          <button
            disabled={pending}
            onClick={() => run(() => reopenGrantChange(changeId))}
            className="text-[10px] text-muted hover:text-foreground disabled:opacity-40"
          >
            Reopen
          </button>
        )}
        {error && <p className="max-w-[14rem] text-right text-[10px] text-frc">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {isDeadline && (
        <label className="flex max-w-[16rem] items-start gap-1.5 text-right text-[10px] leading-tight text-muted">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          <span>I opened the funder&rsquo;s page and this date is right.</span>
        </label>
      )}
      <div className="flex gap-2">
        <button
          disabled={pending || (isDeadline && !checked)}
          onClick={onApply}
          title={isDeadline && !checked ? 'Tick the confirmation first' : 'Write this onto the listing'}
          className="rounded bg-rookie/20 px-2.5 py-1 text-xs font-medium text-rookie transition-colors hover:bg-rookie/40 disabled:opacity-40"
        >
          {pending ? '…' : 'Apply'}
        </button>
        <button
          disabled={pending}
          onClick={() => run(() => dismissGrantChange(changeId, note))}
          className="rounded bg-surface-3 px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          {pending ? '…' : 'Dismiss'}
        </button>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why dismissed (optional)"
        className="w-56 rounded border border-border bg-surface px-2 py-1 text-[10px] text-foreground outline-none focus:border-primary"
      />
      {error && <p className="max-w-[16rem] text-right text-[10px] text-frc">{error}</p>}
    </div>
  )
}
