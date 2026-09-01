import Link from 'next/link'
import { Calendar, MapPin, Images } from 'lucide-react'
import { cardClass } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils/cn'
import type { EventSearchResult } from '@the-tool-pit/types'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { AlbumMenu } from './album-menu'
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

/**
 * An event in the photo feed. Not the off-season events vertical's card, which
 * is components/events/event-card.tsx and deliberately carries no controls.
 */
export function EventCard({
  event,
  soleAlbumClaimState,
}: {
  event: EventSearchResult
  /**
   * For a one-album event only: the claim state of that album, resolved on the
   * server for the whole feed. Absent for every other event, whose card leads
   * to the event page and its album cards.
   */
  soleAlbumClaimState?: ListingClaimState
}) {
  const location = formatLocation(event.city, event.stateProv, event.country)
  const dates = formatEventDates(event.startDate, event.endDate)
  const covers = event.coverImages.slice(0, 4)
  // One-album events link straight to the album (new tab) so there's no
  // throwaway single-item event page to back out of.
  const direct = event.soleAlbumUrl
  const linkProps = direct
    ? { href: direct, target: '_blank' as const, rel: 'noopener noreferrer' }
    : { href: `/photos/event/${event.tbaKey}` }

  // A one-album event links straight out to the gallery, so its event page is
  // never reached and neither is the album card that would carry the album's
  // menu. About two thirds of events are this shape, so without a menu here
  // most photographers had no route at all to claiming their own work.
  //
  // A multi-album event gets NO menu: its card leads to the event page, where
  // every album card has its own. A menu here would be a second route to the
  // same items, and the card then renders exactly as it always did.
  const menu =
    direct && event.soleAlbumId ? (
      <AlbumMenu
        albumId={event.soleAlbumId}
        albumUrl={direct}
        claimState={soleAlbumClaimState ?? 'signed_out'}
      />
    ) : null

  // The card can no longer BE the link where it carries a menu: a trigger
  // inside an anchor is invalid, and every click on it would navigate instead
  // of opening. The link covers the card content and the footer sits below it,
  // with group still on the outer element so hover treats the tile as one.
  return (
    // Keeps its own hover instead of the shared background lift: most of this
    // tile is a photo, and a change of surface underneath a photo reads as
    // nothing at all. The border is the affordance here.
    <div
      className={cardClass({
        pad: 'none',
        className: 'group relative flex flex-col overflow-hidden transition-colors hover:border-primary/50',
      })}
    >
      <Link {...linkProps} className="flex flex-1 flex-col">
        {/* Stretched link, the pattern tool-card already uses, so the menu can
            sit on the title row without being nested inside the anchor. A
            button inside an anchor is invalid and navigates on every click. */}
        <span className="absolute inset-0 z-0" aria-hidden />
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

        {/* Title, details and the menu share one row. The menu spent a version
            on a line of its own below the details, which added an empty band to
            every card for the sake of one small control. */}
        <div className="flex items-start justify-between gap-2 p-3">
          <div className="flex min-w-0 flex-col gap-1">
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

          {/* Above the stretched link, so a click here does not follow it. */}
          {menu && <div className="relative z-10 shrink-0">{menu}</div>}
        </div>
      </Link>
    </div>
  )
}
