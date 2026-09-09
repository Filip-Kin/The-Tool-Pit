'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'

/**
 * "Suggest an edit" for a grant. Accountless, like the event and field
 * forms. Everything typed here lands in the admin change queue with the link
 * the visitor points to as evidence; nothing changes on the page until a
 * person applies it. Opened from the footer link, or from a "Know this?"
 * link next to a fact the listing does not have yet, which focuses that
 * field.
 */
export interface SuggestGrantEditProps {
  grantId: string
  current: {
    applicationUrl: string | null
    deadlineType: string
    awardMax: number | null
    effortLevel: string
    summary: string | null
  }
}

const input = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground'
const label = 'text-xs font-medium text-muted'

export function SuggestGrantEdit({ grantId, current }: SuggestGrantEditProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/grants/${grantId}/suggest`, { method: 'POST', body: new FormData(e.currentTarget) })
      const data = (await res.json()) as { ok?: boolean; error?: string; filed?: number }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Could not send that.')
        return
      }
      setDone(`Thanks. ${data.filed} change${data.filed === 1 ? '' : 's'} sent for review; it shows on the page once a person has checked it.`)
    } catch {
      setError('Could not send that. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="suggest-edit" className="scroll-mt-24">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <Pencil className="h-3.5 w-3.5" aria-hidden /> Suggest an edit
        </button>
      ) : done ? (
        <p className="text-sm text-foreground">{done}</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-muted">
            Know something this listing does not? Fill in what you know and the link you saw it on. A person checks it before it goes live.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={label}>Application link (the form itself)</span>
              <input name="applicationUrl" type="url" defaultValue={current.applicationUrl ?? ''} className={input} placeholder="https://" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Deadline</span>
              <input name="deadlineAt" type="date" className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Deadline type</span>
              <select name="deadlineType" defaultValue={current.deadlineType} className={input}>
                <option value="unknown">Not sure</option>
                <option value="fixed">One fixed deadline</option>
                <option value="annual_window">Opens and closes each year</option>
                <option value="rolling">Rolling, no deadline</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Maximum award (USD)</span>
              <input name="awardMax" type="number" min="1" defaultValue={current.awardMax ?? ''} className={input} placeholder="e.g. 5000" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>Effort to apply</span>
              <select name="effortLevel" defaultValue={current.effortLevel} className={input}>
                <option value="unknown">Not sure</option>
                <option value="light">Light: a form, under an hour</option>
                <option value="moderate">Moderate: a short proposal</option>
                <option value="heavy">Heavy: a full proposal with budget</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={label}>Who is eligible (in the funder&apos;s words)</span>
              <textarea name="eligibilityText" rows={2} className={input} />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={label}>Summary (if ours is wrong)</span>
              <textarea name="summary" rows={2} defaultValue={current.summary ?? ''} className={input} />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={label}>Anything else</span>
              <textarea name="note" rows={2} className={input} placeholder="What you know that the page does not say" />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={cn(label, 'text-foreground')}>Where did you see this? (required)</span>
              <input name="evidenceUrl" type="url" required className={input} placeholder="https://funder.org/grants/..." />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className={label}>Your email (optional, in case a reviewer has a question)</span>
              <input name="email" type="email" className={input} />
            </label>
          </div>
          {error && <p className="text-sm text-reg-closed">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send for review'}</Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  )
}

/** A small nudge next to a fact the listing does not have yet. */
export function KnowThisLink({ what }: { what: string }) {
  return (
    <a href="#suggest-edit" className="ml-2 text-xs text-primary hover:underline">
      Know the {what}? Tell us
    </a>
  )
}
