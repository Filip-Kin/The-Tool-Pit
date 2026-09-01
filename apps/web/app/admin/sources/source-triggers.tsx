'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
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
      <Button
        onClick={handleClick}
        disabled={pending}
        variant="secondary" size="sm"
      >
        {pending ? 'Queuing…' : `Crawl ${label}`}
      </Button>
      {result?.ok && <p className="text-xs text-official">Queued ✓</p>}
      {result?.error && <p className="text-xs text-frc">Error: {result.error}</p>}
    </div>
  )
}
