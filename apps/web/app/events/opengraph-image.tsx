import { OG_CONTENT_TYPE, OG_SIZE, renderVerticalOgCard } from '@/lib/og/card'

/**
 * Share card for the off-season events INDEX (frc.tools/events).
 *
 * The lucide CalendarDays glyph, the same icon the site shows this vertical
 * with in the header switcher and the home vertical cards.
 */
export const alt = 'Off-season events on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function EventsOgImage() {
  return renderVerticalOgCard({
    name: 'Off-season events',
    tagline: 'Off-season competitions on a map, with cost, capacity and registration status.',
    icon: [
      <path key="a" d="M8 2v4" />,
      <path key="b" d="M16 2v4" />,
      <rect key="c" width="18" height="18" x="3" y="4" rx="2" />,
      <path key="d" d="M3 10h18" />,
      <path key="e" d="M8 14h.01" />,
      <path key="f" d="M12 14h.01" />,
      <path key="g" d="M16 14h.01" />,
      <path key="h" d="M8 18h.01" />,
      <path key="i" d="M12 18h.01" />,
      <path key="j" d="M16 18h.01" />,
    ],
  })
}
