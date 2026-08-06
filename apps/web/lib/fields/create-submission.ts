import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { practiceFields, fieldPhotos, FIELD_COVERAGE, FIELD_PERIMETER, FIELD_ELEMENTS, FIELD_AVAILABILITY, FIELD_PROGRAMS } from '@the-tool-pit/db'
import type { NewPracticeField } from '@the-tool-pit/db'
import { fieldSpecSummary } from '@/lib/fields/field-display'
import { notifyNewFieldSubmission } from './notify'

export interface CreateFieldSubmissionInput {
  name: string
  teamNumber?: number
  teamName?: string
  program?: string
  latitude?: number
  longitude?: number
  address?: string
  city?: string
  region?: string
  country?: string
  coverage?: string
  perimeter?: string
  elements?: string
  hasFms?: boolean
  aprilTags?: boolean
  ceilingHeightFt?: number
  availability?: string
  hours?: string
  contactInfo?: string
  contactUrl?: string
  website?: string
  notes?: string
  submitterName?: string
  submitterContact?: string
  submitterIpHash: string
  /** Optional photo to attach and review before publish. */
  photo?: { data: Buffer; contentType: string }
}

export interface CreateFieldSubmissionResult {
  fieldId?: string
  status: 'pending' | 'error'
  message: string
}

function pickEnum<T extends readonly string[]>(value: string | undefined, allowed: T, fallback: T[number]): T[number] {
  return value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback
}

const CURRENT_YEAR = new Date().getFullYear()

export async function createFieldSubmission(
  input: CreateFieldSubmissionInput,
): Promise<CreateFieldSubmissionResult> {
  const name = input.name?.trim()
  if (!name) return { status: 'error', message: 'A field name is required.' }

  const db = getDb()

  const coverage = pickEnum(input.coverage, FIELD_COVERAGE, 'full')
  const elements = pickEnum(input.elements, FIELD_ELEMENTS, 'wood')
  const hasFms = Boolean(input.hasFms)

  // Sanity-clamp coordinates; drop them if out of range so the map never gets junk.
  const lat = typeof input.latitude === 'number' && Math.abs(input.latitude) <= 90 ? input.latitude : null
  const lng = typeof input.longitude === 'number' && Math.abs(input.longitude) <= 180 ? input.longitude : null

  const teamNumber =
    typeof input.teamNumber === 'number' && Number.isInteger(input.teamNumber) && input.teamNumber > 0
      ? input.teamNumber
      : null

  const ceiling =
    typeof input.ceilingHeightFt === 'number' && input.ceilingHeightFt > 0 && input.ceilingHeightFt < 200
      ? input.ceilingHeightFt
      : null

  const values: NewPracticeField = {
    name,
    teamNumber,
    teamName: input.teamName?.trim() || null,
    program: pickEnum(input.program, FIELD_PROGRAMS, 'frc'),
    latitude: lat,
    longitude: lng,
    address: input.address?.trim() || null,
    city: input.city?.trim() || null,
    region: input.region?.trim() || null,
    country: input.country?.trim() || null,
    coverage,
    perimeter: pickEnum(input.perimeter, FIELD_PERIMETER, 'none'),
    elements,
    hasFms,
    // Every practice field is assumed to have AprilTags set up, so it's no
    // longer a per-field toggle - always true.
    aprilTags: true,
    ceilingHeightFt: ceiling,
    availability: pickEnum(input.availability, FIELD_AVAILABILITY, 'unknown'),
    hours: input.hours?.trim() || null,
    contactInfo: input.contactInfo?.trim() || null,
    contactUrl: input.contactUrl?.trim() || null,
    website: input.website?.trim() || null,
    notes: input.notes?.trim() || null,
    submitterName: input.submitterName?.trim() || null,
    submitterContact: input.submitterContact?.trim() || null,
    submitterIpHash: input.submitterIpHash,
    status: 'pending',
    source: 'submission',
  }

  const [row] = await db.insert(practiceFields).values(values).returning({ id: practiceFields.id })

  // Store the uploaded photo (reviewed before the field is published) and point
  // the field's photoUrl at the serving route.
  if (input.photo) {
    await db.insert(fieldPhotos).values({
      fieldId: row.id,
      contentType: input.photo.contentType,
      data: input.photo.data,
    })
    await db
      .update(practiceFields)
      .set({ photoUrl: `/api/fields/photo/${row.id}`, updatedAt: new Date() })
      .where(eq(practiceFields.id, row.id))
  }

  void notifyNewFieldSubmission({
    name,
    teamNumber,
    city: values.city,
    region: values.region,
    spec: fieldSpecSummary({ coverage, elements, hasFms }),
  })

  return {
    fieldId: row.id,
    status: 'pending',
    message: "Thanks! We'll review this field and add it to the map.",
  }
}

export { CURRENT_YEAR }
