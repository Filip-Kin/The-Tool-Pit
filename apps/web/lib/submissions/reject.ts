import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { submissions } from '@the-tool-pit/db'
import { notifySubmissionRejected } from '@/lib/notify/approvals'

/**
 * Say no to a submission before it ever becomes a candidate. One body for the
 * admin Reject button and for a ❌ in Discord on a post the worker has not
 * turned into a candidate yet.
 *
 * A submission is not a listing, so nothing here could have been live. Taking
 * down the tool a submission produced is suppressCandidate's job. The reason
 * is required, same as everywhere else. It is the email.
 */
export async function rejectSubmissionBody(submissionId: string, reason: string): Promise<{ error?: string }> {
  const clean = reason?.trim() ?? ''
  if (!clean) return { error: 'Give a reason. It is what the submitter is told.' }

  await getDb()
    .update(submissions)
    .set({ status: 'rejected', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(submissions.id, submissionId))
  await notifySubmissionRejected(submissionId, clean)
  return {}
}
