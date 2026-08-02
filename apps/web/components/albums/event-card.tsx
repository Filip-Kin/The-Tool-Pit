import Link from 'next/link'
import { Calendar, MapPin, Images } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { EventSearchResult } from '@the-tool-pit/types'
import { formatEventDates, formatLocation } from './format'

export function EventCard({ event }: { event: EventSearchResult }) {
  const location = formatLocation(event.city, event.stateProv, event.country)
  const dates = formatEventDates(event.startDate, event.endDate)

  return (
    <Link
      href={`/event/${event.eventCode}`}
      className="group flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-primary/50 hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
          {event.name}
        </h3>
        {event.week != null && <Badge variant="season">Wk {event.week}</Badge>}
      </div>

      <div className="flex flex-col gap-1 text-sm text-muted">
        {dates && (
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            {dates}
          </span>
        )}
        {location && (
          <span className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {location}
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="font-mono text-xs text-muted-2">{event.eventCode}</span>
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Images className="h-3.5 w-3.5" />
          {event.albumCount} {event.albumCount === 1 ? 'album' : 'albums'}
        </span>
      </div>
    </Link>
  )
}
