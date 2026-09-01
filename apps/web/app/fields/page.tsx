import type { Metadata } from 'next'
import Link from 'next/link'
import { getPublishedFields } from '@/lib/queries/fields'
import { FieldsExplorer } from '@/components/fields/fields-explorer'

export const metadata: Metadata = {
  title: { absolute: 'Practice Field Map' },
}

// Always render fresh so newly-approved fields appear on a hard refresh.
export const dynamic = 'force-dynamic'

export default async function FieldsHomePage() {
  const fields = await getPublishedFields()

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
          <Link
            href="/fields/submit"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Be the first to add one
          </Link>
        </div>
      ) : (
        <FieldsExplorer fields={fields} />
      )}
    </div>
  )
}
