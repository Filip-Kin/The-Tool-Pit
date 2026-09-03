import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublishedEventById } from '@/lib/queries/event-listings'
import { EventDetail } from '@/components/events/event-card'
import { ClaimListingButton } from '@/components/auth/claim-listing-button'
import { listingClaimState } from '@/lib/queries/listing-ownership'
import { eventDateRange, eventLocation, costLabel } from '@/lib/events/event-display'
import { eventListingUrl } from '@the-tool-pit/types'
import { JsonLd } from '@/components/seo/json-ld'
import { eventJsonLd } from '@/lib/seo/structured-data'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const ev = await getPublishedEventById(id)
  if (!ev) return { title: 'Event not found' }
  const date = eventDateRange(ev)
  const title = date ? `${ev.name} · ${date}` : ev.name
  const url = eventListingUrl(ev.id)
  const location = eventLocation(ev)
  const cost = costLabel(ev)
  // One-line summary from the listing's own facts: date, place, cost.
  const description = [date, location, cost].filter(Boolean).join(' · ') || ev.name
  const image = { url: `${url}/opengraph-image`, width: 1200, height: 630, alt: title }
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'article', images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  }
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ev = await getPublishedEventById(id)
  if (!ev) notFound()

  const claimState = await listingClaimState('event', ev.id)

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <JsonLd data={eventJsonLd(ev)} />
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
