'use client'

import { useState, useTransition } from 'react'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export function SubmitForm() {
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<{ status: string; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)

    if (!url.trim()) {
      setError('Please enter a URL.')
      return
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim(), note: note.trim() || undefined }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? 'Submission failed.')
        } else {
          setResult(data)
          setUrl('')
          setNote('')
        }
      } catch {
        setError('Network error. Please try again.')
      }
    })
  }

  if (result && result.status !== 'rejected') {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-rookie/30 bg-rookie/10 p-4">
        <CheckCircle className="h-5 w-5 shrink-0 text-rookie mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">Submitted!</p>
          <p className="text-sm text-muted mt-0.5">{result.message}</p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="url" className="text-sm font-medium text-foreground">
          Tool URL <span className="text-frc">*</span>
        </label>
        <input
          id="url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/my-tool"
          required
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="note" className="text-sm font-medium text-foreground">
          Note <span className="text-muted">(optional)</span>
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything you'd like us to know about this tool…"
          rows={3}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors resize-none"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-frc/30 bg-frc/10 p-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-frc mt-0.5" />
          <p className="text-sm text-muted">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {isPending ? 'Submitting…' : 'Submit Tool'}
      </button>

      <p className="text-xs text-muted-2">
        No account required. We review all submissions before publishing.
      </p>
    </form>
  )
}
