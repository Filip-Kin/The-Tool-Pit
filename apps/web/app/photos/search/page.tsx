import { redirect } from 'next/navigation'
import { AlbumSearchBar } from '@/components/albums/album-search-bar'
import { EventList } from '@/components/albums/event-list'
import { searchEvents, getEventByCode } from '@/lib/queries/albums'

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>
}

export default async function AlbumSearchPage({ searchParams }: PageProps) {
  const params = await searchParams
  const query = (params.q ?? '').trim()
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)

  // Exact event-code match → jump straight to the event page.
  if (query && /^[a-z0-9-]+$/i.test(query)) {
    const ev = await getEventByCode(query)
    if (ev) redirect(`/event/${ev.eventCode}`)
  }

  const { events, total } = query
    ? await searchEvents({ query, page, pageSize: 20 })
    : { events: [], total: 0 }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8">
        <AlbumSearchBar defaultValue={query} size="md" />
      </div>

      {query ? (
        <>
          <p className="mb-6 text-sm text-muted">
            {total} {total === 1 ? 'event' : 'events'} matching “{query}”
          </p>
          <EventList events={events} emptyMessage={`No events found for “${query}”.`} />
        </>
      ) : (
        <p className="text-sm text-muted">Type an event name, event code, or team number to search.</p>
      )}
    </div>
  )
}
