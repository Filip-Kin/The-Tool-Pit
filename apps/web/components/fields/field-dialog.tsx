'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { X, ArrowLeft, Link2 } from 'lucide-react'
import type { PublicField } from '@/lib/fields/field-display'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { cn } from '@/lib/utils/cn'
import { ClaimListingButton } from '@/components/auth/claim-listing-button'
import { FieldDetail } from './field-card'
import { FieldSubmitForm } from './field-submit-form'

// A quiet footer link, matching ClaimListingButton's weight so the whole row
// reads as one set of asides rather than a call to action.
const FOOTER_LINK =
  'inline-flex items-center gap-1.5 text-sm text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline'

/**
 * Modal showing a field's full details (photo, spec, access, notes, links).
 * Opened by clicking a list card or a map pin. "Suggest an edit" swaps the
 * content to a pre-filled edit form that submits a proposal for admin review.
 * Renders above the map's stacking context via a Radix portal.
 *
 * It carries the ownership control because /fields/[id] has one and nothing
 * ever linked there. Every route into a field, a list card and a map pin, ends
 * in this dialog, so the page with the claim button on it was unreachable and
 * a team running a field had no way to say so. The permalink below fixes the
 * other half: the detail page is now something you can get to and share.
 */
export function FieldDialog({
  field,
  claimState,
  onClose,
}: {
  field: PublicField | null
  /** Resolved on the server for every field on the map, in one query. */
  claimState: ListingClaimState
  onClose: () => void
}) {
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
                {/* The form has already swapped itself for the green-check
                    confirmation by the time this fires. Give it a beat on screen,
                    then close the dialog so the reader lands back on the map. */}
                <FieldSubmitForm
                  edit={{ field }}
                  onSubmitted={() => setTimeout(() => { setEditing(false); onClose() }, 1500)}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <FieldDetail field={field} />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle pt-4">
                  <ClaimListingButton entityType="field" entityId={field.id} state={claimState} />
                  {/* Just the words: "suggest" already says it is a proposal that
                      gets reviewed, so no "Something out of date?" preamble. */}
                  <button type="button" onClick={() => setEditing(true)} className={FOOTER_LINK}>
                    Suggest an edit
                  </button>
                  {/* Pinned right: the permalink is a share handle, not an action,
                      so it sits apart from the two things you DO here. */}
                  <Link href={`/fields/${field.slug}`} className={cn(FOOTER_LINK, 'ml-auto')}>
                    <Link2 className="h-4 w-4" aria-hidden />
                    Permalink
                  </Link>
                </div>
              </div>
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
