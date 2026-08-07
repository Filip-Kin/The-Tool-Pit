'use client'

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, ArrowLeft } from 'lucide-react'
import type { PublicField } from '@/lib/fields/field-display'
import { FieldDetail } from './field-card'
import { FieldSubmitForm } from './field-submit-form'

/**
 * Modal showing a field's full details (photo, spec, access, notes, links).
 * Opened by clicking a list card or a map pin. "Suggest an edit" swaps the
 * content to a pre-filled edit form that submits a proposal for admin review.
 * Renders above the map's stacking context via a Radix portal.
 */
export function FieldDialog({ field, onClose }: { field: PublicField | null; onClose: () => void }) {
  const [editing, setEditing] = useState(false)

  // Always start on the detail view when a different field opens.
  useEffect(() => {
    setEditing(false)
  }, [field?.id])

  return (
    <Dialog.Root
      open={!!field}
      onOpenChange={(open) => {
        if (!open) {
          setEditing(false)
          onClose()
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[2001] max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-surface p-6 shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">{field?.name ?? 'Practice field'}</Dialog.Title>
          {field &&
            (editing ? (
              <div className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex items-center gap-1 self-start text-sm text-muted hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" /> Back to details
                </button>
                <h2 className="text-lg font-semibold text-foreground">Suggest an edit</h2>
                <FieldSubmitForm edit={{ field }} onSubmitted={() => { /* keep the confirmation visible */ }} />
              </div>
            ) : (
              <FieldDetail field={field} onSuggestEdit={() => setEditing(true)} />
            ))}
          <Dialog.Close
            aria-label="Close"
            className="absolute right-4 top-4 rounded-md p-1 text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
