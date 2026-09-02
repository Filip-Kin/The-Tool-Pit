'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Check, X } from 'lucide-react'
import { applyEventEdit, rejectEventEdit } from './actions'
import { ReasonButton } from '@/components/admin/reason-button'

export function EventEditActions({ proposalId }: { proposalId: string }) {
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={() =>
          startTransition(async () => {
            const res = await applyEventEdit(proposalId)
            if (res?.error) setMsg(res.error)
          })
        }
        disabled={pending}
      >
        <Check className="h-3 w-3" /> Apply
      </Button>
      <ReasonButton
        label={<><X className="h-3 w-3" /> Reject</>}
        confirmLabel="Reject"
        disabled={pending}
        onConfirm={(reason) => rejectEventEdit(proposalId, reason)}
      />
      {msg && <span className="text-xs text-official">{msg}</span>}
    </div>
  )
}
