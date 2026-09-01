'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq, and, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { practiceFields, fieldEditProposals, fieldPhotos, fieldEditProposalPhotos } from '@the-tool-pit/db'
import type { FieldEditProposalData } from '@the-tool-pit/db'
import { describeFieldEditChanges, notifyFieldEditApplied } from '@/lib/notify/approvals'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

function revalidateAll() {
  revalidatePath('/admin/field-edits')
  revalidatePath('/fields')
}

/** Apply a pending edit proposal to its field, then mark it applied. */
export async function applyFieldEdit(proposalId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()
  const [proposal] = await db
    .select()
    .from(fieldEditProposals)
    .where(eq(fieldEditProposals.id, proposalId))
    .limit(1)
  if (!proposal) return { error: 'Proposal not found' }
  if (proposal.status !== 'pending') return { error: 'This proposal was already handled.' }

  const p = proposal.proposed as FieldEditProposalData
  // Only assign columns the proposal carries; ignore anything unexpected.
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  const assign = <K extends keyof FieldEditProposalData>(k: K, col: string) => {
    if (p[k] !== undefined) patch[col] = p[k]
  }
  assign('name', 'name')
  assign('teamNumber', 'teamNumber')
  assign('teamName', 'teamName')
  assign('program', 'program')
  assign('latitude', 'latitude')
  assign('longitude', 'longitude')
  assign('address', 'address')
  assign('city', 'city')
  assign('region', 'region')
  assign('country', 'country')
  assign('coverage', 'coverage')
  assign('perimeter', 'perimeter')
  assign('elements', 'elements')
  assign('hasFms', 'hasFms')
  assign('ceilingHeightFt', 'ceilingHeightFt')
  assign('availability', 'availability')
  assign('hours', 'hours')
  assign('contactInfo', 'contactInfo')
  assign('contactUrl', 'contactUrl')
  assign('website', 'website')
  assign('notes', 'notes')
  if (!p.name || !(p.name as string).trim()) return { error: 'Proposed name is empty.' }

  // Read the field as it stands before the patch lands. This is the only moment
  // the before-state exists, and the whole point of the email is telling the
  // submitter WHICH of their suggestions was taken.
  const [before] = await db
    .select()
    .from(practiceFields)
    .where(eq(practiceFields.id, proposal.fieldId))
    .limit(1)
  const changed = before ? describeFieldEditChanges(p, before as unknown as Record<string, unknown>) : []

  await db.update(practiceFields).set(patch).where(eq(practiceFields.id, proposal.fieldId))

  // Apply the photo changes: remove the requested existing photos, then append
  // the proposal's pending photos to the field's gallery.
  const removeIds = (proposal.removePhotoIds ?? []) as string[]
  if (removeIds.length > 0) {
    await db
      .delete(fieldPhotos)
      .where(and(eq(fieldPhotos.fieldId, proposal.fieldId), inArray(fieldPhotos.id, removeIds)))
  }

  const pending = await db
    .select()
    .from(fieldEditProposalPhotos)
    .where(eq(fieldEditProposalPhotos.proposalId, proposalId))
  if (pending.length > 0) {
    const remaining = await db
      .select({ sortOrder: fieldPhotos.sortOrder })
      .from(fieldPhotos)
      .where(eq(fieldPhotos.fieldId, proposal.fieldId))
    let nextOrder = remaining.reduce((m, r) => Math.max(m, r.sortOrder + 1), 0)
    await db.insert(fieldPhotos).values(
      pending.map((ph) => ({ fieldId: proposal.fieldId, contentType: ph.contentType, data: ph.data, sortOrder: nextOrder++ })),
    )
    // Reclaim the pending bytea now that the photos live on the field.
    await db.delete(fieldEditProposalPhotos).where(eq(fieldEditProposalPhotos.proposalId, proposalId))
  }

  await db
    .update(fieldEditProposals)
    .set({ status: 'applied', updatedAt: new Date() })
    .where(eq(fieldEditProposals.id, proposalId))
  await notifyFieldEditApplied(proposalId, changed)
  revalidateAll()
  return {}
}

export async function rejectFieldEdit(proposalId: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  // Drop the pending photo bytes; the proposal row stays for the record.
  await db.delete(fieldEditProposalPhotos).where(eq(fieldEditProposalPhotos.proposalId, proposalId))
  await db
    .update(fieldEditProposals)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(eq(fieldEditProposals.id, proposalId))
  revalidatePath('/admin/field-edits')
}
