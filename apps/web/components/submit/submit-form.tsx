'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { PassingAlongCheckbox } from '@/components/submit/passing-along-checkbox'
import { PASSING_ALONG_DEFAULT } from '@/lib/listings/passing-along'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SubmitConfirmation } from '@/components/ui/submit-confirmation'
import { useTurnstile } from '@/components/ui/use-turnstile'
import Link from 'next/link'

// Extend Window to hold the Turnstile API injected by Cloudflare's script


export function SubmitForm({ admin }: {
  /**
   * Admin mode, for /admin/new/tool. Same form, because the fields are the
   * same fields and a second one would drift from this one. The Turnstile
   * check goes (an admin session already proved who this is), and so do the
   * private submitter box and the passing-along question where they exist.
   *
   * A hint to the UI and NOT a permission: the route it posts to checks the
   * admin session itself, so flipping this in devtools gets a 401.
   */
  admin?: boolean
} = {}) {
  const adminMode = !!admin
  // An admin session stands in for the bot check. Nothing else turns it off.
  const turnstile = useTurnstile(!adminMode)

  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<{ submissionId?: string; status: string; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Unticked, like every other submit form. A tool you sent in while signed in
  // is yours to manage once it is approved; tick the box to decline it.
  const [passingAlong, setPassingAlong] = useState(PASSING_ALONG_DEFAULT.tool)
  const [isPending, startTransition] = useTransition()


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)

    if (!url.trim()) {
      setError('Please enter a URL.')
      return
    }

    if (turnstile.required && !turnstile.token) {
      setError('Please complete the CAPTCHA.')
      return
    }

    startTransition(async () => {
      try {
        const res = await fetch(adminMode ? '/admin/api/listings/tool' : '/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url.trim(),
            note: note.trim() || undefined,
            // Always explicit, never left to a default the server would have to guess.
            passingAlong,
            turnstileToken: turnstile.token ?? undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? 'Submission failed.')
          // Reset the widget so the submitter can retry.
          turnstile.reset()
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
      <SubmitConfirmation
        message={result.message}
        onSubmitAnother={() => {
          setResult(null)
          setError(null)
        }}
      >
        {result.submissionId && (
          <p className="text-xs text-muted">
            <Link href={`/submissions/${result.submissionId}`} className="underline hover:text-foreground">
              Check submission status →
            </Link>
          </p>
        )}
      </SubmitConfirmation>
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

      {!adminMode && <PassingAlongCheckbox checked={passingAlong} onChange={setPassingAlong} noun="tool" />}

      {/* Cloudflare Turnstile widget, only rendered when a site key is configured */}
      {turnstile.required && <div ref={turnstile.containerRef} className="min-h-[65px]" />}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-frc/30 bg-frc/10 p-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-frc mt-0.5" />
          <p className="text-sm text-muted">{error}</p>
        </div>
      )}

      <Button type="submit" disabled={isPending || (turnstile.required && !turnstile.token)}>
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {isPending ? 'Submitting…' : adminMode ? 'Add tool' : 'Submit Tool'}
      </Button>

      <p className="text-xs text-muted-2">
        No account required. We review all submissions before publishing.
      </p>
    </form>
  )
}
