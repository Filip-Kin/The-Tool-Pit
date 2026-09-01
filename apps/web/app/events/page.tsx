import type { Metadata } from 'next'
import Link from 'next/link'
import { getPublishedEvents } from '@/lib/queries/event-listings'
import { EventsExplorer } from '@/components/events/events-explorer'

export const metadata: Metadata = {
  title: { absolute: 'Off-season FRC events' },
}

// A newly published event, or a fresh scraped team count, has to show up on the
// next hard refresh, so this page is never statically cached.
export const dynamic = 'force-dynamic'

export default async function EventsHomePage() {
  // One instant for the whole render, handed to the client explorer so its
  // timing maths (what is "upcoming", how many days away) matches this HTML.
  const now = new Date()
  const events = await getPublishedEvents()

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Off-season FRC events</h1>
        <p className="max-w-2xl text-sm text-muted">
          The off-season calendar on a map: when each event runs, what it costs, how many team slots are left, and
          whether registration is open. Upcoming events come first.{' '}
          <Link href="/events/submit" className="text-primary hover:underline">
            Running one we are missing?
          </Link>
        </p>
      </div>

      {events.length === 0 ? <EmptyState /> : <EventsExplorer events={events} now={now} />}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-10 text-center">
      <p className="text-sm text-muted">No events on the map yet.</p>
      <Link href="/events/submit" className="mt-3 inline-block text-sm text-primary hover:underline">
        Add the first one
      </Link>
    </div>
  )
}
