import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublishedFieldById } from '@/lib/queries/fields'
import { FieldDetail } from '@/components/fields/field-card'
import { ClaimListingButton } from '@/components/auth/claim-listing-button'
import { listingClaimState } from '@/lib/queries/listing-ownership'
import { fieldUrl } from '@the-tool-pit/types'
import { JsonLd } from '@/components/seo/json-ld'
import { fieldJsonLd } from '@/lib/seo/structured-data'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const field = await getPublishedFieldById(id)
  if (!field) return { title: 'Field not found' }
  const title = field.teamNumber ? `${field.teamNumber} · ${field.name}` : field.name
  return { title, alternates: { canonical: fieldUrl(field.id) } }
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
