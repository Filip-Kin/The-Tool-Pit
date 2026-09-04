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
  // Do NOT hardcode `${url}/opengraph-image`. This route lives in the (public)
  // route group, and Next.js gives metadata image routes inside a route group a
  // hashed path segment (…/opengraph-image-<hash>), so a hand-built URL 404s.
  // Leaving images unset lets Next auto-merge this segment's opengraph-image.tsx
  // at its real hashed, absolute URL (resolved against metadataBase).
  return {
    title: tool.name,
    description,
    alternates: { canonical: url },
    openGraph: { title: tool.name, description, url, type: 'article' },
    twitter: { card: 'summary_large_image', title: tool.name, description },
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
