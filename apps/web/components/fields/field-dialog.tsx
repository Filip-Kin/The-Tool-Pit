'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { PublicField } from '@/lib/fields/field-display'
import { FieldDetail } from './field-card'

/**
 * Modal showing a field's full details (photo, spec, access, notes, links).
 * Opened by clicking a list card or a map pin. Renders above the map's stacking
 * context via a Radix portal.
 */
export function FieldDialog({ field, onClose }: { field: PublicField | null; onClose: () => void }) {
  return (
    <Dialog.Root open={!!field} onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[2001] max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-surface p-6 shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">{field?.name ?? 'Practice field'}</Dialog.Title>
          {field && <FieldDetail field={field} />}
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
