import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublishedFieldById } from '@/lib/queries/fields'
import { FieldDetail } from '@/components/fields/field-card'
import { ClaimListingButton } from '@/components/auth/claim-listing-button'
import { listingClaimState } from '@/lib/queries/listing-ownership'
import { fieldUrl } from '@the-tool-pit/types'
import { fieldSpecSummary } from '@/lib/fields/field-display'
import { JsonLd } from '@/components/seo/json-ld'
import { fieldJsonLd } from '@/lib/seo/structured-data'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const field = await getPublishedFieldById(id)
  if (!field) return { title: 'Field not found' }
  const title = field.teamNumber ? `${field.teamNumber} · ${field.name}` : field.name
  const url = fieldUrl(field.id)
  const location = [field.city, field.region, field.country].filter(Boolean).join(', ')
  // One-line summary: where the field is and what it offers.
  const description = [location, fieldSpecSummary(field)].filter(Boolean).join(' · ') || field.name
  const image = { url: `${url}/opengraph-image`, width: 1200, height: 630, alt: title }
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'article', images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  }
}

export default async function FieldDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const field = await getPublishedFieldById(id)
  if (!field) notFound()

  const claimState = await listingClaimState('field', field.id)

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <JsonLd data={fieldJsonLd(field)} />
      <Link href="/" className="text-sm text-muted hover:text-foreground">← Back to the map</Link>
      <div className="mt-4">
        <FieldDetail field={field} />
      </div>
      {/* Additive: anyone can still suggest an edit without an account. This is
          only a shortcut for the person who actually runs the field. */}
      <div className="mt-6">
        <ClaimListingButton entityType="field" entityId={field.id} state={claimState} />
      </div>
    </div>
  )
}
