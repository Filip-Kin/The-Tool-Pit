'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { triggerCrawl } from '../crawls/actions'

export function SourceTriggerButton({ connector, label }: { connector: string; label: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok?: boolean; error?: string } | null>(null)

  function handleClick() {
    setResult(null)
    startTransition(async () => {
      const res = await triggerCrawl(connector)
      setResult(res.error ? { error: res.error } : { ok: true })
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={pending}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Queuing…' : `Crawl ${label}`}
      </button>
      {result?.ok && <p className="text-xs text-official">Queued ✓</p>}
      {result?.error && <p className="text-xs text-frc">Error: {result.error}</p>}
    </div>
  )
}
