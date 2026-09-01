import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getToolBySlug, getVotedToolIds } from '@/lib/queries/tools'
import { listingClaimState } from '@/lib/queries/listing-ownership'
import { ToolDetail } from '@/components/tools/tool-detail'
import { recordClickEvent } from '@/lib/analytics/events'

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const tool = await getToolBySlug(slug)
  if (!tool) return { title: 'Tool Not Found' }
  return {
    title: tool.name,
    description: tool.summary ?? undefined,
  }
}

export default async function ToolPage({ params }: PageProps) {
  const { slug } = await params
  const tool = await getToolBySlug(slug)
  if (!tool) notFound()

  // The detail page rendered its vote button unpressed no matter what, so a
  // tool you had upvoted from a grid looked unvoted the moment you opened it.
  const [voted, claimState] = await Promise.all([
    getVotedToolIds([tool.id]),
    listingClaimState('tool', tool.id),
  ])

  return <ToolDetail tool={tool} voted={voted.has(tool.id)} claimState={claimState} />
}
