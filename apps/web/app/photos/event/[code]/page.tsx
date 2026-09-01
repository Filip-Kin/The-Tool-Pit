import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { Calendar, MapPin, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AlbumGrid } from '@/components/albums/album-grid'
import { AlbumOwnershipSection, type AlbumOwnershipRow } from '@/components/albums/album-ownership-section'
import { formatEventDates, formatLocation } from '@/components/albums/format'
import { getEventPage, displayEventName } from '@/lib/queries/albums'
import { listingClaimStates } from '@/lib/queries/listing-ownership'

interface PageProps {
  params: Promise<{ code: string }>
}

/**
 * Per visitor now, so it cannot be cached.
 *
 * The album cards carry an ownership control, and which one of the four it is
 * depends on who is signed in. Reading the session cookie already forces a
 * dynamic render; saying so here means the next person to add a revalidate
 * knows it would be wrong rather than finding out from a stale menu.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params
  const data = await getEventPage(code)
  if (!data) return { title: 'Event not found' }
  const name = displayEventName(data.event)
  return {
    title: `${name} Photos`,
    description: `Photo albums from ${name} (${data.event.eventCode}, ${data.event.year}).`,
  }
}

export default async function EventPage({ params }: PageProps) {
  const { code } = await params
  const data = await getEventPage(code)
  if (!data) notFound()
  // A division key rolls up to its parent championship - use one canonical URL.
  if (data.parentTbaKey !== code) redirect(`/photos/event/${data.parentTbaKey}`)

  const { event, albums, divisions } = data
  const allAlbums = [...albums, ...divisions.flatMap((d) => d.albums)]
  const name = displayEventName(event)
  const dates = formatEventDates(event.startDate, event.endDate)
  const location = formatLocation(event.city, event.stateProv, event.country)
  const totalAlbums = allAlbums.length

  // One resolve for the parent grid, every division grid and the ownership
  // list. The biggest page in the database today is a championship with eight
  // albums across four events, so this is one query where per card would be
  // sixteen.
  const claimStates = await listingClaimStates('album', allAlbums.map((a) => a.id))

  // The list only earns its space once there is more than one album to tell
  // apart. A single-album page has one card and one menu, which is not a hunt.
  const ownershipRows: AlbumOwnershipRow[] =
    totalAlbums > 1
      ? [
          ...albums.map((a) => ({ album: a, groupLabel: null })),
          ...divisions.flatMap((d) => d.albums.map((a) => ({ album: a, groupLabel: d.label }))),
        ]
      : []

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-primary/15 px-2 py-0.5 text-sm font-bold text-primary">
            {event.year}
          </span>
          <Badge variant="default">{event.eventCode}</Badge>
          {event.eventType === 99 || event.eventType === 100 ? (
            <Badge variant="offseason" className="whitespace-nowrap">Offseason</Badge>
          ) : event.week != null ? (
            <Badge variant="season" className="whitespace-nowrap">Week {event.week}</Badge>
          ) : null}
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{name}</h1>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
          {dates && (
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              {dates}
            </span>
          )}
          {location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              {location}
            </span>
          )}
          <a
            href={`https://www.thebluealliance.com/event/${event.tbaKey}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-primary hover:text-primary-hover"
          >
            The Blue Alliance
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      <h2 className="mb-4 text-lg font-semibold text-foreground">
        {totalAlbums} {totalAlbums === 1 ? 'album' : 'albums'}
      </h2>
      <AlbumGrid albums={albums} claimStates={claimStates} />

      {divisions.map((d) => (
        <section key={d.event.id} className="mt-10">
          <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
            {d.label}
            <span className="font-mono text-xs font-normal text-muted-2">{d.event.eventCode}</span>
          </h3>
          <AlbumGrid albums={d.albums} claimStates={claimStates} />
        </section>
      ))}

      <AlbumOwnershipSection rows={ownershipRows} claimStates={claimStates} />
    </div>
  )
}
