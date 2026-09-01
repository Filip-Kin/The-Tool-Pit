/**
 * The worker's one reason to queue a notification.
 *
 * Almost every "your submission is live" email comes off an admin action in
 * apps/web. This is the exception: a tool submission whose classifier
 * confidence clears the bar is published by the pipeline with no admin
 * involved, and the person who sent it in is owed the same email as everyone
 * whose submission went past a human.
 */
import { eq } from 'drizzle-orm'
import { getDb, queueNotification, submissions, tools } from '@the-tool-pit/db'
import { toolUrl, type ApprovalEmailPayload } from '@the-tool-pit/types'

/**
 * A submission was auto-published by the pipeline. Tell the submitter, if we
 * know who they are.
 *
 * Never throws. The tool is in the directory by the time this runs and a
 * notification failure must not fail the enrich job and send the whole thing
 * round again.
 */
export async function notifySubmissionAutoPublished(submissionId: string, toolId: string): Promise<void> {
  try {
    const db = getDb()

    const [submission] = await db
      .select({
        id: submissions.id,
        userId: submissions.submittedByUserId,
        teamNumber: submissions.teamNumber,
        seasonYear: submissions.seasonYear,
        artifactKind: submissions.artifactKind,
      })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1)
    // Anonymous, which is the normal case on this route. Nothing to do.
    if (!submission?.userId) return

    const [tool] = await db
      .select({ name: tools.name, slug: tools.slug, summary: tools.summary })
      .from(tools)
      .where(eq(tools.id, toolId))
      .limit(1)
    if (!tool) return

    const facts: Array<{ label: string; value: string }> = []
    if (tool.summary?.trim()) facts.push({ label: 'What it says', value: tool.summary.trim() })
    if (submission.teamNumber) facts.push({ label: 'Team', value: `Team ${submission.teamNumber}` })
    if (submission.seasonYear) facts.push({ label: 'Season', value: String(submission.seasonYear) })
    if (submission.artifactKind === 'cad') facts.push({ label: 'Filed as', value: 'CAD' })
    if (submission.artifactKind === 'code') facts.push({ label: 'Filed as', value: 'Robot code' })

    const payload: ApprovalEmailPayload = {
      title: tool.name,
      url: toolUrl(tool.slug),
      facts,
    }

    // Same kind and the same dedupe key shape as the admin path, so a
    // submission auto-published here and then re-approved by an admin from the
    // candidate queue is still one email.
    await queueNotification({
      userId: submission.userId,
      kind: 'tool_published',
      subjectType: 'submission',
      subjectId: submission.id,
      payload,
    })
  } catch (err) {
    console.error(`[notify] tool_published for submission ${submissionId} failed: ${(err as Error).message}`)
  }
}
