import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getToolBySlug } from '@/lib/queries/tools'
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

  return <ToolDetail tool={tool} />
}
