import { OG_CONTENT_TYPE, OG_SIZE, renderVerticalOgCard } from '@/lib/og/card'

/**
 * Share card for the grants INDEX (frc.tools/grants).
 *
 * The lucide CircleDollarSign glyph, the same icon the site shows this vertical
 * with.
 */
export const alt = 'Grants for FIRST teams on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function GrantsOgImage() {
  return renderVerticalOgCard({
    name: 'Grants',
    tagline: 'Funding your FIRST team can apply for, with deadlines checked by a person before they appear.',
    icon: [
      <circle key="a" cx="12" cy="12" r="10" />,
      <path key="b" d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />,
      <path key="c" d="M12 18V6" />,
    ],
  })
}
