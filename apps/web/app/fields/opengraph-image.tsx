import { OG_CONTENT_TYPE, OG_SIZE, renderVerticalOgCard } from '@/lib/og/card'

/**
 * Share card for the practice fields INDEX (frc.tools/fields).
 *
 * The lucide MapPin glyph, the same icon the site shows this vertical with.
 */
export const alt = 'Practice fields on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function FieldsOgImage() {
  return renderVerticalOgCard({
    name: 'Practice fields',
    tagline: 'A community map of FRC practice fields you can visit, filterable by field type, FMS and availability.',
    icon: [
      <path key="a" d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />,
      <circle key="b" cx="12" cy="10" r="3" />,
    ],
  })
}
