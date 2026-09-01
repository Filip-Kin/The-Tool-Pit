'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { practiceFieldCandidates, practiceFields } from '@the-tool-pit/db'
import { bumpListingSourceCounter, practiceFieldFromCandidate } from '@/lib/admin/listing-discovery'

const QUEUE_PATH = '/admin/practice-fields/candidates'

/**
 * Practice-field candidate moderation.
 *
 * This queue rejects more than it accepts by design. The Chief Delphi
 * connector cannot tell "our field is open, come practice" from "does anyone
 * near Detroit have a field", so both arrive here and a human reads the quoted
 * post. Accepting writes a `source: 'scrape'`, `status: 'pending'` field with
 * no coordinates and no spec, which still has to clear the same review a
 * mentor's own submission does.
 */

function revalidateAll() {
  revalidatePath(QUEUE_PATH)
  revalidatePath('/admin/practice-fields')
}

async function loadCandidate(candidateId: string) {
  const db = getDb()
  const [row] = await db
    .select()
    .from(practiceFieldCandidates)
    .where(eq(practiceFieldCandidates.id, candidateId))
    .limit(1)
  return row ?? null
}

/**
 * Find a field by uuid, or by team number when a plain number is pasted. Team
 * number is what a reviewer has in front of them on the candidate, so it is
 * the ref that saves a round trip to the fields screen.
 */
async function findField(ref: string) {
  const clean = ref.trim().toLowerCase()
  if (!clean) return null
  const db = getDb()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)
  if (!isUuid && !/^\d{1,5}$/.test(clean)) return null

  const [row] = await db
    .select({ id: practiceFields.id, name: practiceFields.name })
    .from(practiceFields)
    .where(isUuid ? eq(practiceFields.id, clean) : eq(practiceFields.teamNumber, Number(clean)))
    .limit(1)
  return row ?? null
}

/**
 * Accept a candidate into a pending field.
 *
 * `name` comes from the form because practice_fields.name is NOT NULL and the
 * connector only reads a facility name when the thread gave one that is not
 * just the title. The spec columns land on their defaults and are not read out
 * of the thread, so a reviewer sets coverage, perimeter, elements and FMS
 * before this can be published.
 */
export async function acceptFieldCandidate(candidateId: string, name: string): Promise<{ error?: string; fieldId?: string }> {
  await assertAdmin()
  const db = getDb()

  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }
  if (candidate.matchedFieldId) return { error: 'This candidate is already attached to a field.' }

  const clean = name.trim()
  if (!clean) return { error: 'Give the field a name before accepting it.' }

  const [created] = await db
    .insert(practiceFields)
    .values(practiceFieldFromCandidate(candidate, clean))
    .returning({ id: practiceFields.id })
  if (!created) return { error: 'The field was not written. Nothing has changed.' }

  await db
    .update(practiceFieldCandidates)
    .set({ status: 'published', matchedFieldId: created.id, rejectionReason: null, updatedAt: new Date() })
    .where(eq(practiceFieldCandidates.id, candidateId))
  await bumpListingSourceCounter('field', candidate.sourceId, 'yield')

  revalidateAll()
  return { fieldId: created.id }
}

/**
 * Attach a candidate to a field we already list, e.g. a second thread from a
 * team whose field is on the map. Counts as a useful find for the source.
 */
export async function attachFieldCandidate(candidateId: string, fieldRef: string): Promise<{ error?: string }> {
  await assertAdmin()
  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  const field = await findField(fieldRef)
  if (!field) return { error: `No field found for "${fieldRef}". Paste its id or the team number.` }

  await getDb()
    .update(practiceFieldCandidates)
    .set({ status: 'matched', matchedFieldId: field.id, rejectionReason: null, updatedAt: new Date() })
    .where(eq(practiceFieldCandidates.id, candidateId))
  await bumpListingSourceCounter('field', candidate.sourceId, 'yield')

  revalidateAll()
  return {}
}

/**
 * Suppress with a reason. Most of this queue leaves this way, so the reason is
 * the record of WHY: "asking for a field, not offering one" repeated fifty
 * times against one source is the case for changing the search, and the reject
 * tally is what makes it visible.
 */
export async function suppressFieldCandidate(candidateId: string, reason: string): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = reason.trim()
  if (!clean) return { error: 'Give a reason, even a short one.' }

  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  await getDb()
    .update(practiceFieldCandidates)
    .set({ status: 'suppressed', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(practiceFieldCandidates.id, candidateId))
  await bumpListingSourceCounter('field', candidate.sourceId, 'reject')

  revalidateAll()
  return {}
}

/**
 * Mark a duplicate. No reject bump, for the same reason as the events queue:
 * finding the same real field twice is not noise.
 */
export async function markFieldCandidateDuplicate(candidateId: string, fieldRef: string): Promise<{ error?: string }> {
  await assertAdmin()
  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  let matchedFieldId: string | null = candidate.matchedFieldId
  let note = 'Duplicate'
  if (fieldRef.trim()) {
    const field = await findField(fieldRef)
    if (!field) return { error: `No field found for "${fieldRef}". Leave it blank if it duplicates another candidate.` }
    matchedFieldId = field.id
    note = `Duplicate of ${field.name}`
  }

  await getDb()
    .update(practiceFieldCandidates)
    .set({ status: 'duplicate', matchedFieldId, rejectionReason: note, updatedAt: new Date() })
    .where(eq(practiceFieldCandidates.id, candidateId))

  revalidateAll()
  return {}
}

/** Put a candidate back in the pending queue after a wrong call. */
export async function reopenFieldCandidate(candidateId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }
  if (candidate.status === 'published') {
    return { error: 'This one is already a field. Delete the field first if it should not exist.' }
  }

  await getDb()
    .update(practiceFieldCandidates)
    .set({ status: 'pending', rejectionReason: null, matchedFieldId: null, updatedAt: new Date() })
    .where(eq(practiceFieldCandidates.id, candidateId))

  revalidateAll()
  return {}
}
