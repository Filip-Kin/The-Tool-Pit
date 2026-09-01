import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { toolVotes, tools } from '@the-tool-pit/db'
import type { VoteResponse } from '@the-tool-pit/types'

interface ToggleVoteInput {
  toolId: string
  voterFingerprint: string
  ipHash: string
  /** The signed-in account, when there is one. See the note on toolVotes.userId. */
  userId?: string | null
}

/**
 * Toggle a vote for a tool. If the voter already voted, remove the vote.
 * Also updates the tool's denormalized popularityScore.
 */
export async function toggleVote(input: ToggleVoteInput): Promise<VoteResponse> {
  const db = getDb()
  const { toolId, voterFingerprint, ipHash, userId } = input

  // Who this vote belongs to. An account owns its votes across every browser it
  // signs in from; a signed-out visitor is only ever their cookie. Matching on
  // the account FIRST is what makes an upvote survive a new browser, and it is
  // why toggling has to look for either shape before deciding.
  const owner = userId
    ? sql`(${toolVotes.userId} = ${userId}::uuid or ${toolVotes.voterFingerprint} = ${voterFingerprint})`
    : sql`${toolVotes.voterFingerprint} = ${voterFingerprint}`

  const existing = await db
    .select({ id: toolVotes.id })
    .from(toolVotes)
    .where(sql`${toolVotes.toolId} = ${toolId}::uuid and ${owner}`)

  let voted: boolean

  if (existing.length > 0) {
    // Every matching row, not just the first. A person who voted anonymously
    // and then signed in can briefly hold two, and un-voting must leave none.
    await db.delete(toolVotes).where(
      sql`${toolVotes.id} in (${sql.join(existing.map((r) => sql`${r.id}::uuid`), sql`, `)})`,
    )
    voted = false
  } else {
    await db.insert(toolVotes).values({ toolId, voterFingerprint, ipHash, userId: userId ?? null })
    voted = true
  }

  // Get updated vote count
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(toolVotes)
    .where(sql`${toolVotes.toolId} = ${toolId}::uuid`)

  // Fetch external upvotes (GitHub stars + ChiefDelphi likes)
  const [toolRow] = await db
    .select({ githubStars: tools.githubStars, chiefDelphiLikes: tools.chiefDelphiLikes })
    .from(tools)
    .where(sql`${tools.id} = ${toolId}::uuid`)
    .limit(1)

  const externalUpvotes = (toolRow?.githubStars ?? 0) + (toolRow?.chiefDelphiLikes ?? 0)
  const combinedScore = count + externalUpvotes

  // Denormalize popularity score (vote count + external upvotes + click events contribute separately)
  await db
    .update(tools)
    .set({ popularityScore: combinedScore, updatedAt: new Date() })
    .where(sql`${tools.id} = ${toolId}::uuid`)

  return { voted, voteCount: combinedScore }
}
