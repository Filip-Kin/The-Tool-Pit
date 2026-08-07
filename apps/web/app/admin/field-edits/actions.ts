'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { practiceFields, fieldEditProposals } from '@the-tool-pit/db'
import type { FieldEditProposalData } from '@the-tool-pit/db'

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

  await db.update(practiceFields).set(patch).where(eq(practiceFields.id, proposal.fieldId))
  await db
    .update(fieldEditProposals)
    .set({ status: 'applied', updatedAt: new Date() })
    .where(eq(fieldEditProposals.id, proposalId))
  revalidateAll()
  return {}
}

export async function rejectFieldEdit(proposalId: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  await db
    .update(fieldEditProposals)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(eq(fieldEditProposals.id, proposalId))
  revalidatePath('/admin/field-edits')
}
