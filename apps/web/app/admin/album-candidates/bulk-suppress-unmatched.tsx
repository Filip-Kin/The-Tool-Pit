'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { buttonClass } from '@/components/ui/button'
import { suppressUnmatchedBacklog } from './actions'

/**
 * Clears the "no event matched" backlog in one click. These are crawled albums
 * the machine could not tie to an event and no submitter is waiting on. Confirms
 * first and shows the count, matching the other bulk actions in the admin.
 */
export function BulkSuppressUnmatched({ count }: { count: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (count === 0) return null

  function onClick() {
    if (!confirm(`Suppress ${count} unmatched album${count === 1 ? '' : 's'}? They move to the suppressed tab with a rejection reason and can be re-matched later.`)) {
      return
    }
    setError(null)
    start(async () => {
      const res = await suppressUnmatchedBacklog()
      if (res?.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={onClick}
        className={buttonClass({ variant: 'none', size: 'sm', className: 'border border-frc/40 text-frc hover:bg-frc/10' })}
      >
        {pending ? '…' : `Suppress ${count} unmatched`}
      </button>
      {error && <span className="text-xs text-frc">{error}</span>}
    </div>
  )
}
