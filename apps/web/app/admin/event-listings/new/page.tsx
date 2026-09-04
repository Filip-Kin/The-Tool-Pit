import Link from 'next/link'
import { assertAdmin } from '@/lib/admin/auth'
import { EventSubmitForm } from '@/components/events/event-submit-form'

export const dynamic = 'force-dynamic'

/**
 * Add an off-season event from the admin side.
 *
 * The public form is the front door and stays the front door. This is the side
 * one, for the events that arrive by email, by DM, or from somebody reading a
 * site the connectors do not sweep. Before it existed a moderator had to open
 * the public form, solve a bot check and then find their own submission in the
 * pending queue to publish it, which is three steps to write a row they were
 * always allowed to write.
 *
 * It is the same form component the public gets. Keeping one form means a
 * field added for teams shows up here too, instead of this page quietly
 * falling a season behind.
 */
export default async function NewEventListingPage() {
  await assertAdmin()

  return (
    <div className="p-4 md:p-6">
      <Link href="/admin/event-listings" className="text-sm text-muted hover:text-foreground">
        ← Off-season events
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-foreground">Add an event</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        For an event that came in by email or off a site nothing sweeps. It is filed as an admin
        entry rather than a public submission, and it goes on the map as soon as it clears the
        publish bar: a pin, a start date, a venue, a program and a registration state.
      </p>

      <div className="mt-5 max-w-3xl">
        <EventSubmitForm admin />
      </div>
    </div>
  )
}
