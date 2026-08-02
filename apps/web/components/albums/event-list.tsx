import type { EventSearchResult } from '@the-tool-pit/types'
import { EventCard } from './event-card'

export function EventList({ events, emptyMessage = 'No events found.' }: { events: EventSearchResult[]; emptyMessage?: string }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">{emptyMessage}</p>
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {events.map((e) => (
        <EventCard key={e.id} event={e} />
      ))}
    </div>
  )
}
