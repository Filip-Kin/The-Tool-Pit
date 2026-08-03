import Link from 'next/link'
import { Calendar, MapPin, Images } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils/cn'
import type { EventSearchResult } from '@the-tool-pit/types'
import { formatEventDates, formatLocation } from './format'

/** TBA event_type 99 = offseason, 100 = preseason. */
function isOffseason(eventType: number | null): boolean {
  return eventType === 99 || eventType === 100
}

/** Collage of album cover images — the focal point of the card. */
function CoverCollage({ covers }: { covers: string[] }) {
  const n = covers.length
  if (n === 0) {
    return (
      <div className="flex aspect-[3/2] w-full items-center justify-center bg-surface-2 text-muted-2">
        <Images className="h-10 w-10" />
      </div>
    )
  }
  return (
    <div
      className={cn(
        'grid aspect-[3/2] w-full overflow-hidden gap-0.5 bg-border-subtle',
        n === 1 && 'grid-cols-1',
        n === 2 && 'grid-cols-2',
        n >= 3 && 'grid-cols-2 grid-rows-2',
      )}
    >
      {covers.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={src}
          alt=""
          loading="lazy"
          className={cn(
            'h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]',
            n === 3 && i === 0 && 'row-span-2',
          )}
        />
      ))}
    </div>
  )
}

export function EventCard({ event }: { event: EventSearchResult }) {
  const location = formatLocation(event.city, event.stateProv, event.country)
  const dates = formatEventDates(event.startDate, event.endDate)
  const covers = event.coverImages.slice(0, 4)
  // One-album events link straight to the album (new tab) so there's no
  // throwaway single-item event page to back out of.
  const direct = event.soleAlbumUrl
  const linkProps = direct
    ? { href: direct, target: '_blank' as const, rel: 'noopener noreferrer' }
    : { href: `/event/${event.tbaKey}` }

  return (
    <Link
      {...linkProps}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-primary/50"
    >
      <div className="relative">
        <CoverCollage covers={covers} />
        {isOffseason(event.eventType) ? (
          <span className="absolute right-2 top-2 whitespace-nowrap rounded-full bg-sky-500 px-2 py-0.5 text-xs font-semibold text-white shadow">
            Offseason
          </span>
        ) : event.week != null ? (
          <span className="absolute right-2 top-2 whitespace-nowrap rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-black shadow">
            Week {event.week}
          </span>
        ) : null}
        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
          <Images className="h-3 w-3" />
          {event.albumCount}
        </span>
      </div>

      <div className="flex flex-col gap-1 p-3">
        <h3 className="line-clamp-1 font-semibold leading-tight text-foreground group-hover:text-primary transition-colors">
          {event.name}
        </h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          {dates && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3 shrink-0" />
              {dates}
            </span>
          )}
          {location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0" />
              {location}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
