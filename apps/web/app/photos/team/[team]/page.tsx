import { ScrollRestorer } from '@/components/albums/scroll-restorer'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AlbumSearchBar } from '@/components/albums/album-search-bar'
import { EventList } from '@/components/albums/event-list'
import { getTeamEvents } from '@/lib/queries/albums'

interface PageProps {
  params: Promise<{ team: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { team } = await params
  return { title: `Team ${team} Events` }
}

export default async function TeamPage({ params }: PageProps) {
  const { team } = await params
  const teamNumber = parseInt(team, 10)
  if (!Number.isInteger(teamNumber) || teamNumber < 1) notFound()

  const events = await getTeamEvents(teamNumber)
  const withAlbums = events.filter((e) => e.albumCount > 0)

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      <ScrollRestorer />
      <div className="mb-8">
        <AlbumSearchBar size="md" />
      </div>

      <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
        Team {teamNumber}
      </h1>
      <p className="mb-6 text-sm text-muted">
        {events.length} {events.length === 1 ? 'event' : 'events'} attended
        {events.length > 0 && ` · ${withAlbums.length} with photo albums`}
      </p>

      <EventList
        events={events}
        emptyMessage={`No events found for team ${teamNumber}. Event data syncs from The Blue Alliance.`}
      />
    </div>
  )
}
