import { OG_CONTENT_TYPE, OG_SIZE, renderVerticalOgCard } from '@/lib/og/card'

/**
 * Share card for the event photos INDEX (frc.tools/photos).
 *
 * The lucide Camera glyph, the same icon the site shows this vertical with.
 */
export const alt = 'Event photos on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function PhotosOgImage() {
  return renderVerticalOgCard({
    name: 'Event photos',
    tagline: 'Photo albums from FIRST events, gathered in one place and searchable by event and team.',
    icon: [
      <path key="a" d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />,
      <circle key="b" cx="12" cy="13" r="3" />,
    ],
  })
}
