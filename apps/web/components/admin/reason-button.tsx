'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, buttonClass } from '@/components/ui/button'

/**
 * A moderation button that will not fire without a reason.
 *
 * WHY THIS EXISTS RATHER THAN SIX INLINE REASON BOXES. Every rejection on the
 * site now emails the person who sent the thing in, and the reason is the body
 * of that email: it is the difference between "we removed your field" and "we
 * removed your field because the address is a school that has since said no".
 * The server actions refuse a blank reason, so without a box here the button
 * would simply stop working, and six hand-rolled boxes would be six chances to
 * get the empty case subtly different.
 *
 * It stays out of the way until it is needed. Closed it is one small button;
 * clicking opens the box, and nothing is sent until Confirm. That keeps the
 * reason a deliberate sentence rather than a field an admin tabs past, which is
 * what makes the email worth receiving.
 *
 * The trigger used to take a className from whichever row it sat in, and eight
 * call sites had supplied five different ones. It styles itself now: the same
 * control doing the same job on eight screens has no reason to look five ways.
 */
export function ReasonButton({
  label,
  confirmLabel = 'Confirm',
  placeholder = 'Why. The submitter is sent this.',
  title,
  disabled,
  onConfirm,
}: {
  /** What the trigger reads when closed. Takes an icon plus text. */
  label: ReactNode
  confirmLabel?: string
  placeholder?: string
  title?: string
  disabled?: boolean
  onConfirm: (reason: string) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        title={title}
        disabled={disabled}
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        {label}
      </Button>
    )
  }

  function confirm() {
    const clean = reason.trim()
    if (!clean) {
      setError('Give a reason. It is what the submitter is told.')
      return
    }
    setError(null)
    start(async () => {
      const res = await onConfirm(clean)
      if (res && 'error' in res && res.error) {
        setError(res.error)
        return
      }
      setOpen(false)
      setReason('')
      router.refresh()
    })
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirm()
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder={placeholder}
        className="w-64 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
      />
      <button
        type="button"
        disabled={pending || !reason.trim()}
        onClick={confirm}
        // Red, because this is the one that sends the rejection email.
        className={buttonClass({ variant: 'none', size: 'sm', className: 'border border-frc/40 text-frc hover:bg-frc/10' })}
      >
        {pending ? '…' : confirmLabel}
      </button>
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => {
          setOpen(false)
          setReason('')
          setError(null)
        }}
      >
        Cancel
      </Button>
      {error && <span className="text-xs text-frc">{error}</span>}
    </span>
  )
}
