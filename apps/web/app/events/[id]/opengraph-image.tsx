import { getPublishedEventById } from '@/lib/queries/event-listings'
import { eventDateRange, eventLocation } from '@/lib/events/event-display'
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard, renderOgFallback } from '@/lib/og/card'

export const alt = 'Off-season event on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

const EYEBROW = 'Off-season event'

export default async function EventOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ev = await getPublishedEventById(id)
  if (!ev) return renderOgFallback(EYEBROW)

  const eyebrow = ev.program ? `${ev.program} off-season event` : EYEBROW
  return renderOgCard({
    eyebrow,
    title: ev.name,
    facts: [eventDateRange(ev), eventLocation(ev)],
  })
}
