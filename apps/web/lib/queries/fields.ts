import { eq, and, isNotNull, desc } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { practiceFields } from '@the-tool-pit/db'
import type { PublicField } from '@/lib/fields/field-display'
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
  photoUrl: practiceFields.photoUrl,
} as const

function toPublic(row: Record<string, unknown>): PublicField {
  return {
    ...row,
    coverage: row.coverage as FieldCoverage,
    perimeter: row.perimeter as FieldPerimeter,
    elements: row.elements as FieldElements,
    availability: row.availability as FieldAvailability,
  } as PublicField
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
  return rows.map(toPublic)
}

/** A single published field by id, for its shareable detail page. */
export async function getPublishedFieldById(id: string): Promise<PublicField | null> {
  const db = getDb()
  const [row] = await db
    .select(publicColumns)
    .from(practiceFields)
    .where(and(eq(practiceFields.id, id), eq(practiceFields.status, 'published')))
    .limit(1)
  return row ? toPublic(row) : null
}
