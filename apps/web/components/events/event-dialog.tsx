'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import { X, ArrowLeft, Link2 } from 'lucide-react'
import type { PublicEvent } from '@/lib/events/event-display'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { cn } from '@/lib/utils/cn'
import { ClaimListingButton } from '@/components/auth/claim-listing-button'
import { EventDetail } from './event-card'
import { EventRosterTable } from './event-roster-table'
import { EventSubmitForm } from './event-submit-form'

// A quiet footer link, matching ClaimListingButton's weight so the whole row
// reads as one set of asides rather than a call to action.
const FOOTER_LINK =
  'inline-flex items-center gap-1.5 text-sm text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline'

/**
 * Modal showing an event's full details. Opened by clicking a list card or a
 * map pin. Renders above the map's stacking context via a Radix portal.
 *
 * It carries the same two affordances the practice-field dialog does, because
 * every route into an event ends here and the shareable /events/[id] page was
 * the only place with the ownership control on it. "Suggest an edit" swaps the
 * body to a pre-filled edit form that submits a proposal for moderation; the
 * permalink is the way to reach and share the detail page.
 */
export function EventDialog({
  event,
  now,
  claimState = 'signed_out',
  onClose,
}: {
  event: PublicEvent | null
  now: Date
  /**
   * Resolved on the server per event, like the field map does. Optional so the
   * explorer can adopt it without this prop landing first; the default offers
   * the claim as a sign-in, which is the honest thing for a signed-out reader.
   */
  claimState?: ListingClaimState
  onClose: () => void
}) {
  const [editing, setEditing] = useState(false)

  // Always start on the detail view when a different event opens.
  useEffect(() => {
    setEditing(false)
  }, [event?.id])

  return (
    <Dialog.Root
      open={!!event}
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
          <Dialog.Title className="sr-only">{event?.name ?? 'Event'}</Dialog.Title>
          {event &&
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
                <EventSubmitForm
                  edit={{ event }}
                  onSubmitted={() => setTimeout(() => { setEditing(false); onClose() }, 1500)}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <EventDetail event={event} now={now} />
                <EventRosterTable eventId={event.id} />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle pt-4">
                  <ClaimListingButton entityType="event" entityId={event.id} state={claimState} />
                  {/* Just the words: "suggest" already says it is a proposal that
                      gets reviewed, so no "Something out of date?" preamble. */}
                  <button type="button" onClick={() => setEditing(true)} className={FOOTER_LINK}>
                    Suggest an edit
                  </button>
                  {/* Pinned right: the permalink is a share handle, not an action,
                      so it sits apart from the two things you DO here. */}
                  <Link href={`/events/${event.id}`} className={cn(FOOTER_LINK, 'ml-auto')}>
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
