'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { practiceFields, fieldPhotos, FIELD_COVERAGE, FIELD_PERIMETER, FIELD_ELEMENTS, FIELD_AVAILABILITY, FIELD_PROGRAMS } from '@the-tool-pit/db'
import { readPhotoFiles } from '@/lib/fields/form-parse'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

function revalidateAll() {
  revalidatePath('/admin/practice-fields')
  revalidatePath('/fields')
}

/** Publish a field. Requires coordinates so it can actually be placed on the map. */
export async function approveField(id: string): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()
  const [f] = await db
    .select({ latitude: practiceFields.latitude, longitude: practiceFields.longitude })
    .from(practiceFields)
    .where(eq(practiceFields.id, id))
    .limit(1)
  if (!f) return { error: 'Field not found' }
  if (f.latitude == null || f.longitude == null) {
    return { error: 'Set a pin location before publishing - it needs coordinates for the map.' }
  }
  await db
    .update(practiceFields)
    .set({ status: 'published', publishedAt: new Date(), rejectionReason: null, updatedAt: new Date() })
    .where(eq(practiceFields.id, id))
  revalidateAll()
  return {}
}

export async function suppressField(id: string, reason?: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  await db
    .update(practiceFields)
    .set({ status: 'suppressed', rejectionReason: reason?.trim() || null, updatedAt: new Date() })
    .where(eq(practiceFields.id, id))
  revalidateAll()
}

export async function unsuppressField(id: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  await db
    .update(practiceFields)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(practiceFields.id, id))
  revalidateAll()
}

export async function deleteField(id: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  // field_photos cascades on delete.
  await db.delete(practiceFields).where(eq(practiceFields.id, id))
  revalidateAll()
}

export interface FieldEditInput {
  name?: string
  teamNumber?: number | null
  teamName?: string | null
  program?: string
  latitude?: number | null
  longitude?: number | null
  address?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  coverage?: string
  perimeter?: string
  elements?: string
  hasFms?: boolean
  aprilTags?: boolean
  ceilingHeightFt?: number | null
  availability?: string
  hours?: string | null
  contactInfo?: string | null
  contactUrl?: string | null
  website?: string | null
  notes?: string | null
}

function inEnum<T extends readonly string[]>(v: string | undefined, allowed: T): T[number] | undefined {
  return v && (allowed as readonly string[]).includes(v) ? (v as T[number]) : undefined
}

/** Edit any field attribute, including repositioning the pin. */
export async function updateField(id: string, input: FieldEditInput): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) {
    if (!input.name.trim()) return { error: 'Name cannot be empty.' }
    patch.name = input.name.trim()
  }
  if (input.teamNumber !== undefined) patch.teamNumber = input.teamNumber
  if (input.teamName !== undefined) patch.teamName = input.teamName?.trim() || null
  if (input.program !== undefined) patch.program = inEnum(input.program, FIELD_PROGRAMS) ?? 'frc'
  if (input.latitude !== undefined) patch.latitude = input.latitude
  if (input.longitude !== undefined) patch.longitude = input.longitude
  if (input.address !== undefined) patch.address = input.address?.trim() || null
  if (input.city !== undefined) patch.city = input.city?.trim() || null
  if (input.region !== undefined) patch.region = input.region?.trim() || null
  if (input.country !== undefined) patch.country = input.country?.trim() || null
  if (input.coverage !== undefined) patch.coverage = inEnum(input.coverage, FIELD_COVERAGE) ?? 'full'
  if (input.perimeter !== undefined) patch.perimeter = inEnum(input.perimeter, FIELD_PERIMETER) ?? 'none'
  if (input.elements !== undefined) patch.elements = inEnum(input.elements, FIELD_ELEMENTS) ?? 'wood'
  if (input.hasFms !== undefined) patch.hasFms = input.hasFms
  if (input.aprilTags !== undefined) patch.aprilTags = input.aprilTags
  if (input.ceilingHeightFt !== undefined) patch.ceilingHeightFt = input.ceilingHeightFt
  if (input.availability !== undefined) patch.availability = inEnum(input.availability, FIELD_AVAILABILITY) ?? 'unknown'
  if (input.hours !== undefined) patch.hours = input.hours?.trim() || null
  if (input.contactInfo !== undefined) patch.contactInfo = input.contactInfo?.trim() || null
  if (input.contactUrl !== undefined) patch.contactUrl = input.contactUrl?.trim() || null
  if (input.website !== undefined) patch.website = input.website?.trim() || null
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null

  await db.update(practiceFields).set(patch).where(eq(practiceFields.id, id))
  revalidateAll()
  return {}
}

/** Admin: add one or more photos to a field's gallery immediately. */
export async function addFieldPhotos(fieldId: string, formData: FormData): Promise<{ error?: string }> {
  await assertAdmin()
  const parsed = await readPhotoFiles(formData, 'photos')
  if ('error' in parsed) return { error: parsed.error }
  if (parsed.photos.length === 0) return { error: 'No photos selected.' }

  const db = getDb()
  const existing = await db
    .select({ sortOrder: fieldPhotos.sortOrder })
    .from(fieldPhotos)
    .where(eq(fieldPhotos.fieldId, fieldId))
  let nextOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder + 1), 0)
  await db.insert(fieldPhotos).values(
    parsed.photos.map((p) => ({ fieldId, contentType: p.contentType, data: p.data, sortOrder: nextOrder++ })),
  )
  revalidateAll()
  return {}
}

/** Admin: remove a single photo from a field's gallery immediately. */
export async function removeFieldPhoto(photoId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()
  await db.delete(fieldPhotos).where(eq(fieldPhotos.id, photoId))
  revalidateAll()
  return {}
}
