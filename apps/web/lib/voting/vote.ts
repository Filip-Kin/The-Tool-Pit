import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { toolVotes, tools } from '@the-tool-pit/db'
import type { VoteResponse } from '@the-tool-pit/types'

interface ToggleVoteInput {
  toolId: string
  voterFingerprint: string
  ipHash: string
}

/**
 * Toggle a vote for a tool. If the voter already voted, remove the vote.
 * Also updates the tool's denormalized popularityScore.
 */
export async function toggleVote(input: ToggleVoteInput): Promise<VoteResponse> {
  const db = getDb()
  const { toolId, voterFingerprint, ipHash } = input

  // Check for existing vote
  const [existing] = await db
    .select({ id: toolVotes.id })
    .from(toolVotes)
    .where(
      sql`${toolVotes.toolId} = ${toolId}::uuid and ${toolVotes.voterFingerprint} = ${voterFingerprint}`,
    )
    .limit(1)

  let voted: boolean

  if (existing) {
    // Remove the vote
    await db.delete(toolVotes).where(eq(toolVotes.id, existing.id))
    voted = false
  } else {
    // Add the vote
    await db.insert(toolVotes).values({ toolId, voterFingerprint, ipHash })
    voted = true
  }

  // Get updated vote count
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(toolVotes)
    .where(sql`${toolVotes.toolId} = ${toolId}::uuid`)

  // Denormalize popularity score (simple: vote count * 1.0 + click events contribute separately)
  await db
    .update(tools)
    .set({ popularityScore: count, updatedAt: new Date() })
    .where(sql`${tools.id} = ${toolId}::uuid`)

  return { voted, voteCount: count }
}
