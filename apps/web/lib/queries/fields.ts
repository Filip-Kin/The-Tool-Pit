import { eq, and, isNotNull, desc, asc, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { practiceFields, fieldPhotos } from '@the-tool-pit/db'
import type { PublicField, FieldPhotoRef } from '@/lib/fields/field-display'
import type { FieldCoverage, FieldElements, FieldAvailability, FieldPerimeter } from '@the-tool-pit/db'

/** Columns exposed publicly - never the submitter audit fields. */
const publicColumns = {
  id: practiceFields.id,
  teamNumber: practiceFields.teamNumber,
  teamName: practiceFields.teamName,
  program: practiceFields.program,
  name: practiceFields.name,
  latitude: practiceFields.latitude,
  longitude: practiceFields.longitude,
  address: practiceFields.address,
  city: practiceFields.city,
  region: practiceFields.region,
  country: practiceFields.country,
  coverage: practiceFields.coverage,
  perimeter: practiceFields.perimeter,
  elements: practiceFields.elements,
  hasFms: practiceFields.hasFms,
  aprilTags: practiceFields.aprilTags,
  ceilingHeightFt: practiceFields.ceilingHeightFt,
  availability: practiceFields.availability,
  hours: practiceFields.hours,
  contactInfo: practiceFields.contactInfo,
  contactUrl: practiceFields.contactUrl,
  website: practiceFields.website,
  notes: practiceFields.notes,
} as const

function toPublic(row: Record<string, unknown>, photos: FieldPhotoRef[]): PublicField {
  return {
    ...row,
    coverage: row.coverage as FieldCoverage,
    perimeter: row.perimeter as FieldPerimeter,
    elements: row.elements as FieldElements,
    availability: row.availability as FieldAvailability,
    photos,
  } as PublicField
}

/** Load gallery photos for a set of fields, grouped by field id (ordered). */
async function photosByField(fieldIds: string[]): Promise<Map<string, FieldPhotoRef[]>> {
  const map = new Map<string, FieldPhotoRef[]>()
  if (fieldIds.length === 0) return map
  const db = getDb()
  const rows = await db
    .select({ id: fieldPhotos.id, fieldId: fieldPhotos.fieldId })
    .from(fieldPhotos)
    .where(inArray(fieldPhotos.fieldId, fieldIds))
    .orderBy(asc(fieldPhotos.sortOrder), asc(fieldPhotos.createdAt))
  for (const r of rows) {
    const list = map.get(r.fieldId) ?? []
    list.push({ id: r.id, url: `/api/fields/photo/${r.id}` })
    map.set(r.fieldId, list)
  }
  return map
}

/**
 * All published fields that have coordinates (so they can be placed on the map).
 * Newest first as a stable tiebreak for the list.
 */
export async function getPublishedFields(): Promise<PublicField[]> {
  const db = getDb()
  const rows = await db
    .select(publicColumns)
    .from(practiceFields)
    .where(
      and(
        eq(practiceFields.status, 'published'),
        isNotNull(practiceFields.latitude),
        isNotNull(practiceFields.longitude),
      ),
    )
    .orderBy(desc(practiceFields.createdAt))
  const photos = await photosByField(rows.map((r) => r.id))
  return rows.map((r) => toPublic(r, photos.get(r.id) ?? []))
}

/** A single published field by id, for its shareable detail page. */
export async function getPublishedFieldById(id: string): Promise<PublicField | null> {
  const db = getDb()
  const [row] = await db
    .select(publicColumns)
    .from(practiceFields)
    .where(and(eq(practiceFields.id, id), eq(practiceFields.status, 'published')))
    .limit(1)
  if (!row) return null
  const photos = await photosByField([row.id])
  return toPublic(row, photos.get(row.id) ?? [])
}
