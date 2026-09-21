import { and, eq } from 'drizzle-orm'
import { crawlCandidates, discordApprovalMessages, type DiscordDecisionVia } from '@the-tool-pit/db'
import { editApprovalMessage, type ApprovalVertical } from '@the-tool-pit/types'
import { getDb } from '@/lib/db'

/**
 * Mark the Discord post about a row as decided, from whichever side decided it.
 *
 * Called AFTER the real decision has been written, never before, and never in
 * a way that can fail it: a channel that cannot be edited is a log line. The
 * admin actions call this with via 'site'; the internal moderate route calls
 * it with via 'discord'. A row that was never announced through the bot (the
 * webhook days, or a notice with no entityId) has no message and this is a
 * quiet no-op.
 *
 * The status flip is conditional on 'pending', which makes it the lock: two
 * decisions racing for the same row edit the message once.
 */
export async function recordDiscordDecision(
  vertical: ApprovalVertical,
  entityId: string,
  decision: { status: 'approved' | 'rejected'; by: string; via: DiscordDecisionVia },
): Promise<void> {
  try {
    const db = getDb()
    const [row] = await db
      .update(discordApprovalMessages)
      .set({ status: decision.status, decidedBy: decision.by, decidedVia: decision.via, decidedAt: new Date() })
      .where(
        and(
          eq(discordApprovalMessages.vertical, vertical),
          eq(discordApprovalMessages.entityId, entityId),
          eq(discordApprovalMessages.status, 'pending'),
        ),
      )
      .returning({ messageId: discordApprovalMessages.messageId, channelId: discordApprovalMessages.channelId })
    if (!row) return
    await editApprovalMessage(row.channelId, row.messageId, decision)
  } catch (err) {
    console.error(`[discord] could not mark ${vertical} ${entityId} ${decision.status}: ${(err as Error).message}`)
  }
}

/**
 * A tool or robot-code post is keyed on the SUBMISSION, because that is the
 * only row that exists when the notice goes out. The decision lands on the
 * candidate the worker made of it later, so the candidate actions look up the
 * submission to find the post. A crawled candidate has none and was never
 * announced, so null here is the normal case, not an error.
 */
export async function submissionIdForCandidate(candidateId: string): Promise<string | null> {
  const [cand] = await getDb()
    .select({ submissionId: crawlCandidates.submissionId })
    .from(crawlCandidates)
    .where(eq(crawlCandidates.id, candidateId))
    .limit(1)
  return cand?.submissionId ?? null
}

/** Which vertical a submission's post was filed under. Robot code and tools share the submissions table. */
export function submissionVertical(artifactKind: string | null | undefined): ApprovalVertical {
  return artifactKind ? 'robot_code' : 'tool'
}
