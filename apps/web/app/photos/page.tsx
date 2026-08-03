import { ScrollRestorer } from '@/components/albums/scroll-restorer'
import { AlbumSearchBar } from '@/components/albums/album-search-bar'
import { SectionHeader } from '@/components/ui/section-header'
import { EventList } from '@/components/albums/event-list'
import { getEventsByDate } from '@/lib/queries/albums'

export default async function PhotosHomePage() {
  const events = await getEventsByDate(60)

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      <ScrollRestorer />
      <section className="mx-auto mb-12 flex max-w-2xl flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          FRC event photos
        </h1>
        <p className="text-balance text-muted">
          Search an event by name or code, or type a team number to see the events they went to.
        </p>
        <div className="w-full">
          <AlbumSearchBar size="lg" autoFocus />
        </div>
      </section>

      <section>
        <SectionHeader title="Recent events" description="Events with photos, newest first." />
        <EventList
          events={events}
          emptyMessage="No albums yet. Submit one to get it started."
        />
      </section>
    </div>
  )
}
