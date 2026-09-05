import { getEventPage, displayEventName } from '@/lib/queries/albums'
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard, renderOgFallback } from '@/lib/og/card'
import { absoluteOgPhotoUrl } from '@/lib/og/photo'

export const alt = 'Event photos on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

const EYEBROW = 'Event photos'

export default async function EventPhotosOgImage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const data = await getEventPage(code)
  if (!data) return renderOgFallback(EYEBROW)

  const name = displayEventName(data.event)
  const allAlbums = [...data.albums, ...data.divisions.flatMap((d) => d.albums)]
  // The first album with a cover fronts the card, the same photo the grid leads
  // with. External (Flickr/SmugMug) or our own /api/albums/cover both work.
  const cover = allAlbums.map((a) => a.coverImageUrl).find((u): u is string => Boolean(u))
  const total = allAlbums.length

  return renderOgCard({
    eyebrow: EYEBROW,
    title: name,
    facts: [
      `${data.event.eventCode} · ${data.event.year}`,
      `${total} photo album${total === 1 ? '' : 's'}`,
    ],
    photoUrl: absoluteOgPhotoUrl(cover),
  })
}
