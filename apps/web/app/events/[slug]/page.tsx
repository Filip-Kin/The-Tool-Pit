import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { getPublishedEventBySlug, getPublishedEventById } from '@/lib/queries/event-listings'
import { EventDetail } from '@/components/events/event-card'
import { ClaimListingButton } from '@/components/auth/claim-listing-button'
import { listingClaimState } from '@/lib/queries/listing-ownership'
import { eventDateRange, eventLocation, costLabel } from '@/lib/events/event-display'
import { eventListingUrl } from '@the-tool-pit/types'
import { JsonLd } from '@/components/seo/json-ld'
import { eventJsonLd } from '@/lib/seo/structured-data'

export const dynamic = 'force-dynamic'

/**
 * A bare UUID in the slot means an old /events/<uuid> permalink, shared before
 * the pretty URL existed. Those links have to keep resolving, so the page looks
 * the row up by id and 301s to its /events/<slug> URL.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const ev = (await getPublishedEventBySlug(slug)) ?? (UUID_RE.test(slug) ? await getPublishedEventById(slug) : null)
  if (!ev) return { title: 'Event not found' }
  const date = eventDateRange(ev)
  const title = date ? `${ev.name} · ${date}` : ev.name
  // Canonical always points at the slug URL, never the UUID.
  const url = eventListingUrl(ev.slug)
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

export default async function EventDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ev = await getPublishedEventBySlug(slug)
  if (!ev && UUID_RE.test(slug)) {
    // An old UUID permalink. Resolve by id and 301 to the canonical slug URL.
    const byId = await getPublishedEventById(slug)
    if (byId) permanentRedirect(`/events/${byId.slug}`)
  }
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
