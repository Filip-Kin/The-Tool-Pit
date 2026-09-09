'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { fieldEditProposals, fieldEditProposalPhotos } from '@the-tool-pit/db'
import { notifyFieldEditRejected } from '@/lib/notify/approvals'
import { applyFieldEditProposal } from '@/lib/fields/apply-edit'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

function revalidateAll() {
  revalidatePath('/admin/field-edits')
  revalidatePath('/fields')
}

/** Apply a pending edit proposal to its field, then mark it applied. Body in lib/fields/apply-edit.ts. */
export async function applyFieldEdit(proposalId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const result = await applyFieldEditProposal(proposalId)
  if (result.error) return result
  revalidateAll()
  return {}
}

/**
 * Do not apply a suggested edit.
 *
 * Never a takedown: the field itself is untouched and stays live exactly as it
 * reads now, which is what the email says so nobody thinks their suggestion
 * took the listing with it. The reason is required, same as everywhere else,
 * and it is what the submitter is sent.
 */
export async function rejectFieldEdit(
  proposalId: string,
  reason: string,
): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = reason?.trim() ?? ''
  if (!clean) return { error: 'Give a reason. It is what the submitter is told.' }

  const db = getDb()
  // Drop the pending photo bytes; the proposal row stays for the record.
  await db.delete(fieldEditProposalPhotos).where(eq(fieldEditProposalPhotos.proposalId, proposalId))
  await db
    .update(fieldEditProposals)
    .set({ status: 'rejected', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(fieldEditProposals.id, proposalId))
  await notifyFieldEditRejected(proposalId, clean)
  revalidatePath('/admin/field-edits')
  return {}
}
