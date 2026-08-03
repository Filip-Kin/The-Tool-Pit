import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Calendar, MapPin, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AlbumGrid } from '@/components/albums/album-grid'
import { formatEventDates, formatLocation } from '@/components/albums/format'
import { getEventWithAlbums } from '@/lib/queries/albums'

interface PageProps {
  params: Promise<{ code: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params
  const data = await getEventWithAlbums(code)
  if (!data) return { title: 'Event not found' }
  return {
    title: `${data.event.name} Photos`,
    description: `Photo albums from ${data.event.name} (${data.event.eventCode}, ${data.event.year}).`,
  }
}

export default async function EventPage({ params }: PageProps) {
  const { code } = await params
  const data = await getEventWithAlbums(code)
  if (!data) notFound()

  const { event, albums } = data
  const dates = formatEventDates(event.startDate, event.endDate)
  const location = formatLocation(event.city, event.stateProv, event.country)

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">{event.eventCode}</Badge>
          {event.week != null && <Badge variant="season">Week {event.week}</Badge>}
          <Badge variant="muted">{event.year}</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{event.name}</h1>
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
        {albums.length} {albums.length === 1 ? 'album' : 'albums'}
      </h2>
      <AlbumGrid albums={albums} />
    </div>
  )
}
