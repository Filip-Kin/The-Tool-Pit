import { OG_CONTENT_TYPE, OG_SIZE, renderVerticalOgCard } from '@/lib/og/card'

/**
 * Share card for the robot code INDEX (frc.tools/robot-code). The lucide Code
 * glyph, the same icon the site shows this vertical with.
 */
export const alt = 'Robot code and CAD from FIRST teams on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function RobotCodeOgImage() {
  return renderVerticalOgCard({
    name: 'Robot code',
    tagline: 'Team robot code and CAD, by team and season.',
    icon: [<polyline key="a" points="16 18 22 12 16 6" />, <polyline key="b" points="8 6 2 12 8 18" />],
  })
}
