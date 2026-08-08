import Link from 'next/link'
import { desc, eq, asc, inArray } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { practiceFields, fieldPhotos, FIELD_STATUSES } from '@the-tool-pit/db'
import type { FieldStatus } from '@the-tool-pit/db'
import type { FieldPhotoRef } from '@/lib/fields/field-display'
import { FieldAdminRow } from './field-admin-row'

export const dynamic = 'force-dynamic'

const TABS: FieldStatus[] = ['pending', 'published', 'suppressed']

export default async function PracticeFieldsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await assertAdmin()
  const { status } = await searchParams
  const active: FieldStatus = (FIELD_STATUSES as readonly string[]).includes(status ?? '')
    ? (status as FieldStatus)
    : 'pending'

  const db = getDb()
  const rows = await db
    .select()
    .from(practiceFields)
    .where(eq(practiceFields.status, active))
    .orderBy(desc(practiceFields.createdAt))

  // Gallery photos for the visible fields, grouped by field id (ordered).
  const photoRows = rows.length
    ? await db
        .select({ id: fieldPhotos.id, fieldId: fieldPhotos.fieldId })
        .from(fieldPhotos)
        .where(inArray(fieldPhotos.fieldId, rows.map((r) => r.id)))
        .orderBy(asc(fieldPhotos.sortOrder), asc(fieldPhotos.createdAt))
    : []
  const photosByField = new Map<string, FieldPhotoRef[]>()
  for (const p of photoRows) {
    photosByField.set(p.fieldId, [...(photosByField.get(p.fieldId) ?? []), { id: p.id, url: `/api/fields/photo/${p.id}` }])
  }

  // Counts per tab for the badges.
  const all = await db.select({ status: practiceFields.status }).from(practiceFields)
  const counts: Record<string, number> = {}
  for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-semibold text-foreground">Practice Fields</h1>
      <p className="mt-1 text-sm text-muted">Review submitted practice fields, place their pin, and publish to the map.</p>

      <div className="mt-4 flex gap-1 border-b border-border-subtle">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/admin/practice-fields?status=${t}`}
            className={
              'rounded-t-md px-3 py-2 text-sm capitalize ' +
              (t === active ? 'border-b-2 border-primary font-medium text-foreground' : 'text-muted hover:text-foreground')
            }
          >
            {t} {counts[t] ? <span className="text-muted-2">({counts[t]})</span> : null}
          </Link>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {rows.length === 0 && <p className="text-sm text-muted-2">Nothing here.</p>}
        {rows.map((f) => (
          <FieldAdminRow key={f.id} field={f} photos={photosByField.get(f.id) ?? []} />
        ))}
      </div>
    </div>
  )
}
