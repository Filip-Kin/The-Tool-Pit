'use server'

import { isAdmin, adminIdentity } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { rejectEventEditProposal } from '@/lib/events/reject-edit'
import { recordDiscordDecision } from '@/lib/discord/decisions'
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
  await recordDiscordDecision('event_edit', proposalId, { status: 'approved', by: await adminIdentity(), via: 'site' })
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
  const result = await rejectEventEditProposal(proposalId, reason)
  if (result.error) return result
  await recordDiscordDecision('event_edit', proposalId, { status: 'rejected', by: await adminIdentity(), via: 'site' })
  revalidatePath('/admin/event-edits')
  return {}
}
