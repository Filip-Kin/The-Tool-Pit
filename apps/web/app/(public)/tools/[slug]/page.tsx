import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getToolBySlug, getVotedToolIds } from '@/lib/queries/tools'
import { listingClaimState } from '@/lib/queries/listing-ownership'
import { getFavoritedIds } from '@/lib/queries/favorites'
import { ToolDetail } from '@/components/tools/tool-detail'
import { recordClickEvent } from '@/lib/analytics/events'
import { toolUrl } from '@the-tool-pit/types'
import { JsonLd } from '@/components/seo/json-ld'
import { toolJsonLd } from '@/lib/seo/structured-data'

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const tool = await getToolBySlug(slug)
  if (!tool) return { title: 'Tool Not Found' }
  const url = toolUrl(tool.slug)
  const description = tool.summary ?? tool.description ?? tool.name
  const image = { url: `${url}/opengraph-image`, width: 1200, height: 630, alt: tool.name }
  return {
    title: tool.name,
    description,
    alternates: { canonical: url },
    openGraph: { title: tool.name, description, url, type: 'article', images: [image] },
    twitter: { card: 'summary_large_image', title: tool.name, description, images: [image] },
  }
}

export default async function ToolPage({ params }: PageProps) {
  const { slug } = await params
  const tool = await getToolBySlug(slug)
  if (!tool) notFound()

  // The detail page rendered its vote button unpressed no matter what, so a
  // tool you had upvoted from a grid looked unvoted the moment you opened it.
  const [voted, favorited, claimState] = await Promise.all([
    getVotedToolIds([tool.id]),
    getFavoritedIds('tool', [tool.id]),
    listingClaimState('tool', tool.id),
  ])

  return (
    <>
      <JsonLd data={toolJsonLd(tool)} />
      <ToolDetail
        tool={tool}
        voted={voted.has(tool.id)}
        favorited={favorited.has(tool.id)}
        claimState={claimState}
      />
    </>
  )
}
