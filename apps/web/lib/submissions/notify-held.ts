import { eq } from 'drizzle-orm'
import { reviewSubmissionUrl } from '@the-tool-pit/types'
import { submissions } from '@the-tool-pit/db'
import { getDb } from '@/lib/db'
import { sendApprovalNotice } from '@/lib/discord/notify'

/**
 * Post a tool submission to the approvals channel once the worker has held it
 * for a person. Posting at submit time asked for approval of tools the worker
 * then published by itself at 70% confidence, so the post waits until a human
 * is actually needed, and says why it was held.
 */
export async function notifyToolSubmissionHeld(submissionId: string, hold: string | null): Promise<{ error?: string }> {
  const [sub] = await getDb()
    .select({ id: submissions.id, url: submissions.url, note: submissions.submitterNote })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1)
  if (!sub) return { error: 'Submission not found.' }
  sendApprovalNotice({
    vertical: 'tool',
    entityId: sub.id,
    title: sub.url,
    reviewUrl: reviewSubmissionUrl(sub.id),
    sourceUrl: sub.url,
    facts: [
      { label: 'Held', value: hold },
      { label: 'Note', value: sub.note ?? null },
    ],
  })
  return {}
}
