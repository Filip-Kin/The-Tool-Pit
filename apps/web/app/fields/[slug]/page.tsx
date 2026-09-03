import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { getPublishedFieldBySlug, getPublishedFieldById } from '@/lib/queries/fields'
import { FieldDetail } from '@/components/fields/field-card'
import { ClaimListingButton } from '@/components/auth/claim-listing-button'
import { listingClaimState } from '@/lib/queries/listing-ownership'
import { fieldUrl } from '@the-tool-pit/types'
import { fieldSpecSummary } from '@/lib/fields/field-display'
import { JsonLd } from '@/components/seo/json-ld'
import { fieldJsonLd } from '@/lib/seo/structured-data'

export const dynamic = 'force-dynamic'

/**
 * A bare UUID in the slot means an old /fields/<uuid> permalink, shared before
 * the pretty URL existed. Those links have to keep resolving, so the page looks
 * the row up by id and 301s to its /fields/<slug> URL.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const field = (await getPublishedFieldBySlug(slug)) ?? (UUID_RE.test(slug) ? await getPublishedFieldById(slug) : null)
  if (!field) return { title: 'Field not found' }
  const title = field.teamNumber ? `${field.teamNumber} · ${field.name}` : field.name
  // Canonical always points at the slug URL, never the UUID.
  const url = fieldUrl(field.slug)
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

export default async function FieldDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const field = await getPublishedFieldBySlug(slug)
  if (!field && UUID_RE.test(slug)) {
    // An old UUID permalink. Resolve by id and 301 to the canonical slug URL.
    const byId = await getPublishedFieldById(slug)
    if (byId) permanentRedirect(`/fields/${byId.slug}`)
  }
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
