import { OG_CONTENT_TYPE, OG_SIZE, renderVerticalOgCard } from '@/lib/og/card'

/**
 * Share card for the robot code INDEX (frc.tools/robot-code). The lucide Code2
 * glyph, the same icon the site shows this vertical with.
 */
export const alt = 'Robot code and CAD from FIRST teams on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function RobotCodeOgImage() {
  return renderVerticalOgCard({
    name: 'Robot code',
    tagline: 'Team robot code and CAD, by team and season.',
    icon: [<path key="a" d="m18 16 4-4-4-4" />, <path key="b" d="m6 8-4 4 4 4" />, <path key="c" d="m14.5 4-5 16" />],
  })
}
