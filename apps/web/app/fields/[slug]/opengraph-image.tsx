import { getPublishedFieldBySlug, getPublishedFieldById } from '@/lib/queries/fields'
import { fieldSpecSummary } from '@/lib/fields/field-display'
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard, renderOgFallback } from '@/lib/og/card'
import { absoluteOgPhotoUrl } from '@/lib/og/photo'

export const alt = 'Practice field on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

const EYEBROW = 'Practice field'

// An old /fields/<uuid>/opengraph-image still renders: resolve by slug, then by
// id when the slot is a bare UUID.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function FieldOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const field = (await getPublishedFieldBySlug(slug)) ?? (UUID_RE.test(slug) ? await getPublishedFieldById(slug) : null)
  if (!field) return renderOgFallback(EYEBROW)

  const location = [field.city, field.region, field.country].filter(Boolean).join(', ')
  const spec = fieldSpecSummary(field)
  const eyebrow = field.teamNumber ? `Practice field · Team ${field.teamNumber}` : EYEBROW

  return renderOgCard({
    eyebrow,
    title: field.name,
    facts: [location, spec],
    // The gallery's first photo is the cover; show it beside the card.
    photoUrl: absoluteOgPhotoUrl(field.photos[0]?.url),
  })
}
