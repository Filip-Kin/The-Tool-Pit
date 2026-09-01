'use client'

import { useState, useTransition } from 'react'
import { buttonClass } from '@/components/ui/button'

export function ReClassifyButton({
  action,
}: {
  action: () => Promise<{ error?: string }>
}) {
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'queued' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function handleClick() {
    setStatus('idle')
    setErrorMsg(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        setStatus('error')
        setErrorMsg(result.error)
      } else {
        setStatus('queued')
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={buttonClass({ variant: 'secondary', size: 'sm' })}
      >
        {pending ? 'Queuing…' : 'Re-classify'}
      </button>
      {status === 'queued' && (
        <span className="text-xs text-rookie">Queued, check candidates</span>
      )}
      {status === 'error' && (
        <span className="text-xs text-frc">{errorMsg}</span>
      )}
    </div>
  )
}
