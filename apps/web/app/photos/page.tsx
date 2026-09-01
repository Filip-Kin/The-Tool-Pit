import type { Metadata } from 'next'
import { AlbumSearchBar } from '@/components/albums/album-search-bar'
import { SectionHeader } from '@/components/ui/section-header'
import { InfiniteEventList } from '@/components/albums/infinite-event-list'
import { getEventsByDatePage } from '@/lib/queries/albums'
import { soleAlbumClaimStates } from '@/lib/albums/claim-states'

/**
 * Not frozen at build time.
 *
 * Without this the page is statically rendered once during the build and
 * served with a year-long cache, so it shows whatever the database said at
 * build time forever. That is how a tool kept showing "Stale" on the home page
 * after the freshness thresholds were widened and the rows had already been
 * recomputed, and how a suppressed listing can keep appearing until the next
 * unrelated deploy. Sixty seconds is far fresher than a deploy and still cheap.
 */
/**
 * Per visitor, so it cannot be cached.
 *
 * This page used to hold a sixty second cache, which was already far fresher
 * than a deploy and stopped the feed freezing at build time. It cannot keep it
 * now: a one album event card carries that album's ownership menu, and which
 * of the four states it shows depends on who is signed in. A cached page would
 * hand one visitor another visitor's answer.
 */
export const dynamic = 'force-dynamic'


// Absolute so the home tab reads "FIRST Event Photos", not the parent
// product's "… | The Tool Pit" template.
export const metadata: Metadata = {
  title: { absolute: 'FIRST Event Photos' },
}

export default async function PhotosHomePage() {
  const first = await getEventsByDatePage({ limit: 30, offset: 0 })
  const claimStates = await soleAlbumClaimStates(first.events)

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
          initialClaimStates={claimStates}
        />
      </section>
    </div>
  )
}
