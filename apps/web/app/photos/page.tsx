import type { Metadata } from 'next'
import { AlbumSearchBar } from '@/components/albums/album-search-bar'
import { SectionHeader } from '@/components/ui/section-header'
import { InfiniteEventList } from '@/components/albums/infinite-event-list'
import { getEventsByDatePage } from '@/lib/queries/albums'

// Absolute so the home tab reads "FIRST Event Photos", not the parent
// product's "… | The Tool Pit" template.
export const metadata: Metadata = {
  title: { absolute: 'FIRST Event Photos' },
}

export default async function PhotosHomePage() {
  const first = await getEventsByDatePage({ limit: 30, offset: 0 })

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
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
        <SectionHeader title="All events" description="Every event with photos, newest first." />
        <InfiniteEventList
          initial={first.events}
          initialOffset={first.rawCount}
          initialHasMore={first.hasMore}
        />
      </section>
    </div>
  )
}
