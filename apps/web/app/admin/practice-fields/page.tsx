import Link from 'next/link'
import { desc, eq, asc, inArray } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { practiceFields, fieldPhotos, users, FIELD_STATUSES } from '@the-tool-pit/db'
import type { FieldStatus } from '@the-tool-pit/db'
import type { FieldPhotoRef } from '@/lib/fields/field-display'
import { FieldAdminRow } from './field-admin-row'

export const dynamic = 'force-dynamic'

/**
 * 'all' is not a status, it is the absence of a filter. The sidebar needs one
 * link per vertical that means "everything we hold", and the three status tabs
 * cannot answer "do we already list this team's field".
 */
const TABS = [...FIELD_STATUSES, 'all'] as const
type Tab = FieldStatus | 'all'

export default async function PracticeFieldsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await assertAdmin()
  const { status } = await searchParams
  const active: Tab = (TABS as readonly string[]).includes(status ?? '') ? (status as Tab) : 'pending'

  const db = getDb()
  // Left join the account, because sign-in is optional on the public form: most
  // rows have no user and must still come back. Columns are pulled out flat
  // rather than as a nested object so the left join's nullability is obvious.
  const rows = await db
    .select({
      field: practiceFields,
      accountId: users.id,
      accountName: users.displayName,
      accountEmail: users.email,
    })
    .from(practiceFields)
    .leftJoin(users, eq(practiceFields.submittedByUserId, users.id))
    .where(active === 'all' ? undefined : eq(practiceFields.status, active))
    .orderBy(desc(practiceFields.createdAt))

  // Gallery photos for the visible fields, grouped by field id (ordered).
  const photoRows = rows.length
    ? await db
        .select({ id: fieldPhotos.id, fieldId: fieldPhotos.fieldId })
        .from(fieldPhotos)
        .where(inArray(fieldPhotos.fieldId, rows.map((r) => r.field.id)))
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
            {t}{' '}
            {t === 'all' ? (
              <span className="text-muted-2">({all.length})</span>
            ) : counts[t] ? (
              <span className="text-muted-2">({counts[t]})</span>
            ) : null}
          </Link>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {rows.length === 0 && <p className="text-sm text-muted-2">Nothing here.</p>}
        {/* id: the Discord notice links straight to the row it is about. */}
        {rows.map((r) => (
          <div key={r.field.id} id={`field-${r.field.id}`} className="scroll-mt-6">
            <FieldAdminRow
              field={r.field}
              photos={photosByField.get(r.field.id) ?? []}
              account={r.accountId ? { id: r.accountId, displayName: r.accountName, email: r.accountEmail } : null}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
