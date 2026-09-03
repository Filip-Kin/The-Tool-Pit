'use client'

import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { PublicEvent } from '@/lib/events/event-display'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { EventDetail } from './event-card'
import { EventRosterTable } from './event-roster-table'
import { EventSubmitForm } from './event-submit-form'
import { ClaimListingButton } from '@/components/auth/claim-listing-button'

/**
 * The interactive body of the shareable /events/[slug] page: the same detail,
 * roster, claim and "suggest an edit" the map dialog carries. The page itself is
 * a server component, so the edit toggle (which swaps the detail for a pre-filled
 * submit form) lives here.
 */
const FOOTER_LINK =
  'inline-flex items-center gap-1.5 text-sm text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline'

export function EventPermalinkBody({
  event,
  claimState,
}: {
  event: PublicEvent
  claimState: ListingClaimState
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="flex items-center gap-1 self-start text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to details
        </button>
        <h2 className="text-lg font-semibold text-foreground">Suggest an edit</h2>
        <EventSubmitForm edit={{ event }} onSubmitted={() => setTimeout(() => setEditing(false), 1500)} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <EventDetail event={event} now={new Date()} />
      <EventRosterTable eventId={event.id} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle pt-4">
        <ClaimListingButton entityType="event" entityId={event.id} state={claimState} />
        <button type="button" onClick={() => setEditing(true)} className={FOOTER_LINK}>
          Suggest an edit
        </button>
      </div>
    </div>
  )
}
