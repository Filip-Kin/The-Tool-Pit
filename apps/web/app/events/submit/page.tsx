import type { Metadata } from 'next'
import Link from 'next/link'
import { EventSubmitForm } from '@/components/events/event-submit-form'

export const metadata: Metadata = {
  title: 'Add an event',
  description: 'List an off-season FRC event so nearby teams can find it.',
}

export default function SubmitEventPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link href="/events" className="text-sm text-muted hover:text-foreground">← Back to the map</Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Add an off-season event</h1>
        <p className="mt-2 text-sm text-muted">
          Listing your event helps teams plan their off-season. Submissions are reviewed before they go on
          the map. Only the event details are shown publicly - your contact details stay with the
          moderators.
        </p>
      </div>
      <EventSubmitForm />
    </div>
  )
}
