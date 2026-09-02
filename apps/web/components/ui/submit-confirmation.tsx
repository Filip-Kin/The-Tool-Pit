'use client'

import { CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The terminal confirmation shown IN PLACE OF a submit form once a submission
 * has gone through. Replacing the form, rather than sitting under it, is the
 * whole point: a form that stays rendered with a re-enabled submit button (and
 * a Turnstile that quietly re-solves) is exactly what let people fire the same
 * submission twice. When this is on screen there is nothing left to resubmit.
 *
 * The green tick and the rookie tint match the tools submit form, which already
 * did this. Standalone pages pass `onSubmitAnother` for a quiet way back to a
 * blank form; the dialog-hosted edit flows leave it off and rely on the dialog
 * close, so the only way on is to reopen the listing.
 */
export function SubmitConfirmation({
  message,
  title = 'Thank you for your submission',
  onSubmitAnother,
  submitAnotherLabel = 'Submit another',
  children,
}: {
  /** The server's own message, shown under the heading. */
  message: string
  title?: string
  /** When set, renders a subtle button that resets the form to submit again. */
  onSubmitAnother?: () => void
  submitAnotherLabel?: string
  /** Extra links or actions, e.g. a status link or the new listing. */
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-rookie/30 bg-rookie/10 p-6 text-center">
        <CheckCircle className="h-10 w-10 shrink-0 text-rookie" />
        <div>
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted">{message}</p>
        </div>
        {children}
      </div>
      {onSubmitAnother && (
        <Button type="button" variant="secondary" onClick={onSubmitAnother}>
          {submitAnotherLabel}
        </Button>
      )}
    </div>
  )
}
