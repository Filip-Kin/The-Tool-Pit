import { TOOL_TYPE_LABELS, type ToolType } from '@the-tool-pit/db'
import { getToolBySlug } from '@/lib/queries/tools'
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard, renderOgFallback } from '@/lib/og/card'

export const alt = 'FIRST robotics tool on frc.tools'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

const EYEBROW = 'Tool for FIRST robotics teams'
const PROGRAM_LABELS: Record<string, string> = { frc: 'FRC', ftc: 'FTC', fll: 'FLL' }

export default async function ToolOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tool = await getToolBySlug(slug)
  if (!tool) return renderOgFallback(EYEBROW)

  const typeLabel = TOOL_TYPE_LABELS[tool.toolType as ToolType] ?? tool.toolType
  const programs = tool.programs.map((p) => PROGRAM_LABELS[p] ?? p.toUpperCase()).join(', ')
  const metaLine = [typeLabel, programs].filter(Boolean).join(' · ')
  const eyebrow = tool.vendorName ? `Tool · ${tool.vendorName}` : EYEBROW

  return renderOgCard({
    eyebrow,
    title: tool.name,
    facts: [tool.summary ?? '', metaLine],
  })
}
