import type { Metadata } from 'next'
import Link from 'next/link'
import { getPublishedEvents, countArchivedEvents } from '@/lib/queries/event-listings'
import { listingClaimStates } from '@/lib/queries/listing-ownership'
import { currentOffseasonSeason } from '@the-tool-pit/db'
import type { SeasonScope } from '@/lib/events/event-display'
import { EventsExplorer } from '@/components/events/events-explorer'

export const metadata: Metadata = {
  title: { absolute: 'Offseason events' },
}

// A newly published event, or a fresh scraped team count, has to show up on the
// next hard refresh, so this page is never statically cached.
export const dynamic = 'force-dynamic'

/**
 * The earlier-years view is a REAL URL, /events?seasons=earlier, not a piece of
 * client state. Two reasons. Somebody who finds a 2026 event through it can
 * send that view to a team mate and have them land on the same thing. And the
 * server can then send one season's listings instead of every season it has
 * ever held, which is what keeps the page the same size in 2032.
 */
function parseScope(value: string | undefined): SeasonScope {
  return value === 'earlier' ? 'earlier' : 'current'
}

export default async function EventsHomePage({
  searchParams,
}: {
  searchParams: Promise<{ seasons?: string }>
}) {
  const { seasons } = await searchParams
  const scope = parseScope(seasons)

  // One instant for the whole render, handed to the client explorer so its
  // timing maths (what is "upcoming", how many days away) matches this HTML.
  const now = new Date()
  const currentSeason = currentOffseasonSeason(now)

  const [events, archivedCount] = await Promise.all([
    getPublishedEvents({ scope, now }),
    countArchivedEvents(now),
  ])

  // Claim state per event, computed here from the session the same way the
  // fields page does. Without it the dialog fell back to its signed_out default
  // and asked a signed-in reader to log in again to claim.
  const claimStates = Object.fromEntries(await listingClaimStates('event', events.map((e) => e.id)))

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">
          {scope === 'earlier' ? 'Offseason events from earlier years' : 'Offseason events'}
        </h1>
        <p className="text-sm text-muted">
          {scope === 'earlier' ? (
            <>
              Every listing from an offseason that has finished. They have all run, and they stay
              here so links to them keep working.{' '}
              <Link href="/events" className="text-primary hover:underline">
                Back to {currentSeason}
              </Link>
            </>
          ) : (
            <>
              Offseason events on a map, upcoming first.{' '}
              <Link href="/events/submit" className="text-primary hover:underline">
                Add one we are missing
              </Link>
            </>
          )}
        </p>
      </div>

      {events.length === 0 ? (
        <EmptyState scope={scope} currentSeason={currentSeason} archivedCount={archivedCount} />
      ) : (
        <EventsExplorer
          events={events}
          now={now}
          scope={scope}
          currentSeason={currentSeason}
          archivedCount={archivedCount}
          claimStates={claimStates}
        />
      )}
    </div>
  )
}

function EmptyState({
  scope,
  currentSeason,
  archivedCount,
}: {
  scope: SeasonScope
  currentSeason: number
  archivedCount: number
}) {
  if (scope === 'earlier') {
    return (
      <div className="rounded-lg border border-border-subtle bg-surface p-10 text-center">
        <p className="text-sm text-muted">No listings from a finished offseason yet.</p>
        <Link href="/events" className="mt-3 inline-block text-sm text-primary hover:underline">
          Back to {currentSeason}
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-10 text-center">
      {/* The January case. The 2026 events archived on the 1st and nobody has
          listed a 2027 one yet, so an unqualified "no events on the map" reads
          as a broken site. Say which year is empty and point at the years that
          are not. */}
      <p className="text-sm text-muted">
        {archivedCount > 0
          ? `No ${currentSeason} offseason events are listed yet.`
          : 'No events on the map yet.'}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-4">
        <Link href="/events/submit" className="text-sm text-primary hover:underline">
          {archivedCount > 0 ? `Add the first ${currentSeason} event` : 'Add the first one'}
        </Link>
        {archivedCount > 0 && (
          <Link href="/events?seasons=earlier" className="text-sm text-primary hover:underline">
            See {archivedCount} from earlier years
          </Link>
        )}
      </div>
    </div>
  )
}
