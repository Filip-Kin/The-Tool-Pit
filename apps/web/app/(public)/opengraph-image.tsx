import { OG_CONTENT_TYPE, OG_SIZE, renderVerticalOgCard } from '@/lib/og/card'

/**
 * Share card for the tools directory INDEX and its pages (frc.tools/).
 *
 * The tools vertical lives at the base host, so its routes sit in the (public)
 * group. This card fronts them with the lucide Wrench glyph, the same icon the
 * site shows this vertical with, instead of the site-wide fallback card. The
 * per-tool detail route under tools/[slug] keeps its own listing card.
 */
export const alt = 'The FRC, FTC and FLL tools directory on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function ToolsOgImage() {
  return renderVerticalOgCard({
    name: 'Tools',
    tagline: 'The community directory of tools, calculators and apps for FRC, FTC and FLL teams.',
    icon: (
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    ),
  })
}
