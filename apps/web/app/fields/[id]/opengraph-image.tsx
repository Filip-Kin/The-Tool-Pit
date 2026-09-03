import { getPublishedFieldById } from '@/lib/queries/fields'
import { fieldSpecSummary } from '@/lib/fields/field-display'
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard, renderOgFallback } from '@/lib/og/card'

export const alt = 'Practice field on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

const EYEBROW = 'Practice field'

export default async function FieldOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const field = await getPublishedFieldById(id)
  if (!field) return renderOgFallback(EYEBROW)

  const location = [field.city, field.region, field.country].filter(Boolean).join(', ')
  const spec = fieldSpecSummary(field)
  const eyebrow = field.teamNumber ? `Practice field · Team ${field.teamNumber}` : EYEBROW

  return renderOgCard({
    eyebrow,
    title: field.name,
    facts: [location, spec],
  })
}
