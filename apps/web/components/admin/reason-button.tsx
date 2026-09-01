'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

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
 * It stays out of the way until it is needed. Closed it is the same button the
 * row had before; clicking opens the box, and nothing is sent until Confirm.
 * That keeps the reason a deliberate sentence rather than a field an admin
 * tabs past, which is what makes the email worth receiving.
 */
export function ReasonButton({
  label,
  confirmLabel = 'Confirm',
  placeholder = 'Why. The submitter is sent this.',
  className = '',
  title,
  disabled,
  onConfirm,
}: {
  /** What the trigger reads when closed. Takes an icon plus text. */
  label: ReactNode
  confirmLabel?: string
  placeholder?: string
  /** Classes for the trigger, so it matches the row it sits in. */
  className?: string
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
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
        className={className}
      >
        {label}
      </button>
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
        className="w-64 rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
      />
      <button
        type="button"
        disabled={pending || !reason.trim()}
        onClick={confirm}
        className="rounded-md border border-frc/40 px-2.5 py-1.5 text-xs font-medium text-frc hover:bg-frc/10 disabled:opacity-40"
      >
        {pending ? '…' : confirmLabel}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setOpen(false)
          setReason('')
          setError(null)
        }}
        className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-40"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-frc">{error}</span>}
    </span>
  )
}
