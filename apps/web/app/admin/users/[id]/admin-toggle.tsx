'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { setUserAdmin } from '../actions'

/** "Make admin" / "Remove admin" for one account. Calls the gated server action, then re-reads the page. */
export function AdminToggle({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [note, setNote] = useState<string | null>(null)

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setUserAdmin(userId, !isAdmin)
            setNote(res.error ?? res.message ?? null)
            if (!res.error) router.refresh()
          })
        }
      >
        {pending ? 'Saving…' : isAdmin ? 'Remove admin' : 'Make admin'}
      </Button>
      {note && <span className="text-xs text-muted">{note}</span>}
    </div>
  )
}
