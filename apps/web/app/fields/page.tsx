import type { Metadata } from 'next'
import Link from 'next/link'
import { ButtonLink } from '@/components/ui/button'
import { getPublishedFields } from '@/lib/queries/fields'
import { listingClaimStates } from '@/lib/queries/listing-ownership'
import { FieldsExplorer } from '@/components/fields/fields-explorer'

export const metadata: Metadata = {
  title: { absolute: 'Practice Field Map' },
}

// Always render fresh so newly-approved fields appear on a hard refresh.
export const dynamic = 'force-dynamic'

export default async function FieldsHomePage() {
  const fields = await getPublishedFields()
  // One query for the whole map, so the dialog can offer ownership the moment
  // a pin is clicked without a round trip per field.
  const claimStates = Object.fromEntries(await listingClaimStates('field', fields.map((f) => f.id)))

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-foreground">Practice Field Map</h1>
        <p className="text-sm text-muted">
          Practice fields teams are willing to share.{' '}
          <Link href="/fields/submit" className="text-primary hover:underline">Add yours</Link>.
        </p>
      </div>

      {fields.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-surface p-10 text-center">
          <p className="text-muted">No practice fields on the map yet.</p>
          <ButtonLink href="/fields/submit" className="mt-4">
            Be the first to add one
          </ButtonLink>
        </div>
      ) : (
        <FieldsExplorer fields={fields} claimStates={claimStates} />
      )}
    </div>
  )
}
