import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublishedEventById } from '@/lib/queries/event-listings'
import { EventDetail } from '@/components/events/event-card'
import { ClaimListingButton } from '@/components/auth/claim-listing-button'
import { listingClaimState } from '@/lib/queries/listing-ownership'
import { eventDateRange } from '@/lib/events/event-display'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const ev = await getPublishedEventById(id)
  if (!ev) return { title: 'Event not found' }
  const date = eventDateRange(ev)
  return { title: date ? `${ev.name} · ${date}` : ev.name }
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ev = await getPublishedEventById(id)
  if (!ev) notFound()

  const claimState = await listingClaimState('event', ev.id)

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <Link href="/events" className="text-sm text-muted hover:text-foreground">← Back to the map</Link>
      <div className="mt-4">
        <EventDetail event={ev} now={new Date()} />
      </div>
      {/* Additive, the same as the practice field page: anyone can still submit
          an event without an account. This is only a shortcut for the organiser
          who actually runs it, so they can keep the cost, the slots and the
          registration state right without waiting on a moderator. */}
      <div className="mt-6">
        <ClaimListingButton entityType="event" entityId={ev.id} state={claimState} />
      </div>
    </div>
  )
}
