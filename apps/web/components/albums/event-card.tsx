import Link from 'next/link'
import { Calendar, MapPin, Images } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { EventSearchResult } from '@the-tool-pit/types'
import { formatEventDates, formatLocation } from './format'

/** TBA event_type 99 = offseason, 100 = preseason. */
function isOffseason(eventType: number | null): boolean {
  return eventType === 99 || eventType === 100
}

export function EventCard({ event }: { event: EventSearchResult }) {
  const location = formatLocation(event.city, event.stateProv, event.country)
  const dates = formatEventDates(event.startDate, event.endDate)
  const covers = event.coverImages.slice(0, 4)

  return (
    <Link
      href={`/event/${event.tbaKey}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-primary/50 hover:bg-surface-2"
    >
      {covers.length > 0 && (
        <div className="flex h-24 gap-px bg-border-subtle">
          {covers.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt=""
              loading="lazy"
              className="h-full min-w-0 flex-1 object-cover"
            />
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
            {event.name}
          </h3>
          {isOffseason(event.eventType) ? (
            <Badge variant="offseason" className="shrink-0 whitespace-nowrap">Offseason</Badge>
          ) : event.week != null ? (
            <Badge variant="season" className="shrink-0 whitespace-nowrap">Week {event.week}</Badge>
          ) : null}
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
      </div>
    </Link>
  )
}
