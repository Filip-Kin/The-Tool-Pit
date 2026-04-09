'use client'

import { useState, useTransition } from 'react'

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
        className="rounded-md border border-blue-600/40 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
      >
        {pending ? 'Queuing…' : 'Re-classify'}
      </button>
      {status === 'queued' && (
        <span className="text-xs text-green-500">Queued — check candidates</span>
      )}
      {status === 'error' && (
        <span className="text-xs text-red-500">{errorMsg}</span>
      )}
    </div>
  )
}
