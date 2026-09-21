'use server'

import { isAdmin, adminIdentity } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { rejectFieldEditProposal } from '@/lib/fields/reject-edit'
import { recordDiscordDecision } from '@/lib/discord/decisions'
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
  await recordDiscordDecision('field_edit', proposalId, { status: 'approved', by: await adminIdentity(), via: 'site' })
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
  const result = await rejectFieldEditProposal(proposalId, reason)
  if (result.error) return result
  await recordDiscordDecision('field_edit', proposalId, { status: 'rejected', by: await adminIdentity(), via: 'site' })
  revalidatePath('/admin/field-edits')
  return {}
}
