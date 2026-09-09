'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventEditProposals } from '@the-tool-pit/db'
import { applyEventEditProposal } from '@/lib/events/apply-edit'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

function revalidateAll() {
  revalidatePath('/admin/event-edits')
  revalidatePath('/events')
}

/** Apply a suggested edit to its event, then mark it applied. Body in lib/events/apply-edit.ts. */
export async function applyEventEdit(proposalId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const result = await applyEventEditProposal(proposalId)
  if (result.error) return result
  revalidateAll()
  return {}
}

/**
 * Do not apply a suggested edit.
 *
 * Never a takedown: the event stays live exactly as it reads now. The reason is
 * required and is the record of why, the same as everywhere else.
 */
export async function rejectEventEdit(proposalId: string, reason: string): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = reason?.trim() ?? ''
  if (!clean) return { error: 'Give a reason, even a short one.' }

  const db = getDb()
  await db
    .update(eventEditProposals)
    .set({ status: 'rejected', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(eventEditProposals.id, proposalId))
  revalidatePath('/admin/event-edits')
  return {}
}
