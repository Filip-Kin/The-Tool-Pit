import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublishedEventById } from '@/lib/queries/event-listings'
import { EventDetail } from '@/components/events/event-card'
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

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <Link href="/events" className="text-sm text-muted hover:text-foreground">← Back to the map</Link>
      <div className="mt-4">
        <EventDetail event={ev} now={new Date()} />
      </div>
    </div>
  )
}
