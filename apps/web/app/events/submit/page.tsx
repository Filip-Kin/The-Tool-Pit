import type { Metadata } from 'next'
import Link from 'next/link'
import { EventSubmitForm } from '@/components/events/event-submit-form'
import { getPublishedEventById } from '@/lib/queries/event-listings'
import { currentOffseasonSeason } from '@the-tool-pit/db'
import type { RenewalPrefill } from '@/components/events/event-submit-form'

export const metadata: Metadata = {
  title: 'Add an event',
  description: 'List an offseason FRC event so nearby teams can find it.',
}

// The renewal path reads a listing, so this page cannot be static.
export const dynamic = 'force-dynamic'

/**
 * Build the prefill for /events/submit?renew=<id>.
 *
 * ONLY PUBLIC COLUMNS, which is what getPublishedEventById already returns.
 * Anybody can put an id in a query string, so this must not show them anything
 * the listing's own page does not already show. What it saves the organiser is
 * re-typing the venue, the pin, the capacity, the cost and every link.
 *
 * The dates are deliberately NOT carried over. They are the one thing that
 * always changes, and a form that arrives holding last year's weekend is a
 * form somebody submits without noticing. Registration state is reset for the
 * same reason: last year's "closed" says nothing about this year.
 */
async function buildRenewal(id: string | undefined): Promise<RenewalPrefill | null> {
  if (!id) return null
  const prev = await getPublishedEventById(id)
  if (!prev) return null
  return {
    previousListingId: prev.id,
    previousListingSlug: prev.slug,
    previousSeasonYear: prev.seasonYear,
    name: prev.name,
    program: prev.program,
    hostTeamNumber: prev.hostTeamNumber,
    hostTeamNumbers: prev.hostTeamNumbers,
    latitude: prev.latitude,
    longitude: prev.longitude,
    venueName: prev.venueName,
    address: prev.address,
    city: prev.city,
    region: prev.region,
    country: prev.country,
    days: prev.days,
    parallelDivisions: prev.parallelDivisions,
    capacity: prev.capacity,
    costUsd: prev.costUsd,
    costNote: prev.costNote,
    website: prev.website,
    registrationUrl: prev.registrationUrl,
    volunteerUrl: prev.volunteerUrl,
    chiefDelphiUrl: prev.chiefDelphiUrl,
    contactEmail: prev.contactEmail,
    notes: prev.notes,
  }
}

export default async function SubmitEventPage({
  searchParams,
}: {
  searchParams: Promise<{ renew?: string }>
}) {
  const { renew } = await searchParams
  const renewal = await buildRenewal(renew)
  const season = currentOffseasonSeason()

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link href="/events" className="text-sm text-muted hover:text-foreground">← Back to the map</Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">
          {renewal ? `List ${renewal.name} for ${season}` : 'Add an offseason event'}
        </h1>
        {renewal ? (
          <p className="mt-2 text-sm text-muted">
            Everything below is copied from the{' '}
            <Link href={`/events/${renewal.previousListingSlug}`} className="text-primary hover:underline">
              {renewal.previousSeasonYear ?? 'previous'} listing
            </Link>
            . Set this year&apos;s dates, fix anything that changed, and submit. Last year&apos;s
            listing stays where it is.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">
            Submissions are reviewed before they go on
            the map. Only the event details are shown publicly - your contact details stay with the
            moderators.
          </p>
        )}
      </div>
      <EventSubmitForm renewal={renewal} />
    </div>
  )
}
