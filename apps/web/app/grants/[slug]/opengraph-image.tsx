import { getGrantBySlug } from '@/lib/queries/grants'
import {
  formatAwardRange,
  formatDeadline,
  geographyLabel,
  resolveNextCycle,
} from '@/lib/grants/grant-display'
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard, renderOgFallback } from '@/lib/og/card'

export const alt = 'Grant for FIRST robotics teams on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

const EYEBROW = 'Grant for FIRST robotics teams'

export default async function GrantOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const grant = await getGrantBySlug(slug)
  if (!grant) return renderOgFallback(EYEBROW)

  const award = formatAwardRange(grant)
  const resolved = resolveNextCycle(grant, new Date())
  const deadline = formatDeadline(resolved.cycle?.deadlineAt ?? null)
  const deadlineLine =
    resolved.state === 'rolling'
      ? 'Rolling deadline'
      : deadline
        ? resolved.isEstimated
          ? `Expected deadline ${deadline}`
          : `Deadline ${deadline}`
        : geographyLabel(grant)

  const awardLine = award ? `Award: ${award}` : geographyLabel(grant)
  const eyebrow = grant.funder ? `Grant · ${grant.funder.name}` : EYEBROW

  return renderOgCard({
    eyebrow,
    title: grant.name,
    facts: [awardLine, deadlineLine],
  })
}
