import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { fieldEditProposals, fieldEditProposalPhotos } from '@the-tool-pit/db'
import { notifyFieldEditRejected } from '@/lib/notify/approvals'

/**
 * Do not apply a suggested field edit. One body for the admin button and for
 * a ❌ in Discord.
 *
 * Never a takedown: the field itself is untouched and stays live exactly as it
 * reads now, which is what the email says so nobody thinks their suggestion
 * took the listing with it. The reason is what the submitter is sent.
 */
export async function rejectFieldEditProposal(proposalId: string, reason: string): Promise<{ error?: string }> {
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
  return {}
}
