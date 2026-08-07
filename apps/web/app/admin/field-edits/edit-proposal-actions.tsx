'use client'

import { useState, useTransition } from 'react'
import { Check, X } from 'lucide-react'
import { applyFieldEdit, rejectFieldEdit } from './actions'

export function EditProposalActions({ proposalId }: { proposalId: string }) {
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() =>
          startTransition(async () => {
            const res = await applyFieldEdit(proposalId)
            if (res?.error) setMsg(res.error)
          })
        }
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
      >
        <Check className="h-3 w-3" /> Apply
      </button>
      <button
        onClick={() => startTransition(() => rejectFieldEdit(proposalId))}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-surface-2"
      >
        <X className="h-3 w-3" /> Reject
      </button>
      {msg && <span className="text-xs text-official">{msg}</span>}
    </div>
  )
}
