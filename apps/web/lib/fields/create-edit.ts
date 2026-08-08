import { eq, and, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { practiceFields, fieldEditProposals, fieldPhotos, fieldEditProposalPhotos, FIELD_COVERAGE, FIELD_PERIMETER, FIELD_ELEMENTS, FIELD_AVAILABILITY, FIELD_PROGRAMS } from '@the-tool-pit/db'
import type { FieldEditProposalData } from '@the-tool-pit/db'
import { notifyFieldEdit } from './notify'

export interface CreateFieldEditInput {
  name?: string
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
  ceilingHeightFt?: number
  availability?: string
  hours?: string
  contactInfo?: string
  contactUrl?: string
  website?: string
  notes?: string
  /** Submitter's explanation of what changed / why. */
  note?: string
  submitterName?: string
  submitterContact?: string
  submitterIpHash: string
  /** New photos to add to the gallery (held pending until an admin applies). */
  newPhotos?: { data: Buffer; contentType: string }[]
  /** IDs of existing field photos the submitter wants removed. */
  removePhotoIds?: string[]
}

export interface CreateFieldEditResult {
  status: 'pending' | 'error'
  message: string
}

function pickEnum<T extends readonly string[]>(value: string | undefined, allowed: T, fallback: T[number]): T[number] {
  return value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback
}

export async function createFieldEditProposal(
  fieldId: string,
  input: CreateFieldEditInput,
): Promise<CreateFieldEditResult> {
  const db = getDb()

  const [field] = await db
    .select({ id: practiceFields.id, name: practiceFields.name, status: practiceFields.status })
    .from(practiceFields)
    .where(eq(practiceFields.id, fieldId))
    .limit(1)
  if (!field || field.status !== 'published') {
    return { status: 'error', message: 'That field could not be found.' }
  }

  const name = input.name?.trim()
  if (!name) return { status: 'error', message: 'A field name is required.' }

  const lat = typeof input.latitude === 'number' && Math.abs(input.latitude) <= 90 ? input.latitude : null
  const lng = typeof input.longitude === 'number' && Math.abs(input.longitude) <= 180 ? input.longitude : null
  const teamNumber =
    typeof input.teamNumber === 'number' && Number.isInteger(input.teamNumber) && input.teamNumber > 0 ? input.teamNumber : null
  const ceiling =
    typeof input.ceilingHeightFt === 'number' && input.ceilingHeightFt > 0 && input.ceilingHeightFt < 200 ? input.ceilingHeightFt : null

  const proposed: FieldEditProposalData = {
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
    coverage: pickEnum(input.coverage, FIELD_COVERAGE, 'full'),
    perimeter: pickEnum(input.perimeter, FIELD_PERIMETER, 'none'),
    elements: pickEnum(input.elements, FIELD_ELEMENTS, 'wood'),
    hasFms: Boolean(input.hasFms),
    ceilingHeightFt: ceiling,
    availability: pickEnum(input.availability, FIELD_AVAILABILITY, 'unknown'),
    hours: input.hours?.trim() || null,
    contactInfo: input.contactInfo?.trim() || null,
    contactUrl: input.contactUrl?.trim() || null,
    website: input.website?.trim() || null,
    notes: input.notes?.trim() || null,
  }

  // Only allow removing photos that actually belong to this field.
  const requestedRemovals = input.removePhotoIds ?? []
  let removePhotoIds: string[] = []
  if (requestedRemovals.length > 0) {
    const owned = await db
      .select({ id: fieldPhotos.id })
      .from(fieldPhotos)
      .where(and(eq(fieldPhotos.fieldId, fieldId), inArray(fieldPhotos.id, requestedRemovals)))
    removePhotoIds = owned.map((r) => r.id)
  }

  const newPhotos = input.newPhotos ?? []

  const [proposal] = await db
    .insert(fieldEditProposals)
    .values({
      fieldId,
      proposed,
      removePhotoIds,
      note: input.note?.trim() || null,
      submitterName: input.submitterName?.trim() || null,
      submitterContact: input.submitterContact?.trim() || null,
      submitterIpHash: input.submitterIpHash,
      status: 'pending',
    })
    .returning({ id: fieldEditProposals.id })

  if (newPhotos.length > 0) {
    await db.insert(fieldEditProposalPhotos).values(
      newPhotos.map((p) => ({ proposalId: proposal.id, contentType: p.contentType, data: p.data })),
    )
  }

  void notifyFieldEdit({
    fieldName: field.name,
    note: input.note,
    addedPhotos: newPhotos.length,
    removedPhotos: removePhotoIds.length,
  })

  return { status: 'pending', message: "Thanks! Your edit is in for review." }
}
