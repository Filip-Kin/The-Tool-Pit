import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPublishedFieldById } from '@/lib/queries/fields'
import { FieldDetail } from '@/components/fields/field-card'
import { ClaimListingButton } from '@/components/auth/claim-listing-button'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const field = await getPublishedFieldById(id)
  if (!field) return { title: 'Field not found' }
  const title = field.teamNumber ? `${field.teamNumber} · ${field.name}` : field.name
  return { title }
}

export default async function FieldDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const field = await getPublishedFieldById(id)
  if (!field) notFound()

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <Link href="/" className="text-sm text-muted hover:text-foreground">← Back to the map</Link>
      <div className="mt-4">
        <FieldDetail field={field} />
      </div>
      {/* Additive: anyone can still suggest an edit without an account. This is
          only a shortcut for the person who actually runs the field. */}
      <div className="mt-6">
        <ClaimListingButton entityType="field" entityId={field.id} />
      </div>
    </div>
  )
}
