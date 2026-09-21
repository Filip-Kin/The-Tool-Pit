import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventEditProposals } from '@the-tool-pit/db'

/**
 * Do not apply a suggested event edit. One body for the admin button and for
 * a ❌ in Discord.
 *
 * Never a takedown: the event stays live exactly as it reads now. The reason
 * is the record of why, the same as everywhere else.
 */
export async function rejectEventEditProposal(proposalId: string, reason: string): Promise<{ error?: string }> {
  const clean = reason?.trim() ?? ''
  if (!clean) return { error: 'Give a reason, even a short one.' }

  await getDb()
    .update(eventEditProposals)
    .set({ status: 'rejected', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(eventEditProposals.id, proposalId))
  return {}
}
