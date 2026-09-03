import { getPublishedEventBySlug, getPublishedEventById } from '@/lib/queries/event-listings'
import { eventDateRange, eventLocation } from '@/lib/events/event-display'
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard, renderOgFallback } from '@/lib/og/card'

export const alt = 'Off-season event on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

const EYEBROW = 'Off-season event'

// An old /events/<uuid>/opengraph-image still renders: resolve by slug, then by
// id when the slot is a bare UUID.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function EventOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ev = (await getPublishedEventBySlug(slug)) ?? (UUID_RE.test(slug) ? await getPublishedEventById(slug) : null)
  if (!ev) return renderOgFallback(EYEBROW)

  const eyebrow = ev.program ? `${ev.program} off-season event` : EYEBROW
  return renderOgCard({
    eyebrow,
    title: ev.name,
    facts: [eventDateRange(ev), eventLocation(ev)],
  })
}
