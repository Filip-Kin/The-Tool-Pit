'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { submissions } from '@the-tool-pit/db'
import { getSubmissionQueue } from '@/lib/submissions/queue'
import { notifySubmissionRejected } from '@/lib/notify/approvals'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

/**
 * Say no to a submission before it ever becomes a candidate.
 *
 * The one action on the site that does NOT do double duty: this screen only
 * offers Reject on a pending or needs_review submission, and a submission is
 * not a listing, so there is nothing here that could have been live. Taking
 * down the tool a submission produced is suppressCandidate's job.
 *
 * The reason is required, same as everywhere else. It is the email.
 */
export async function rejectSubmission(
  submissionId: string,
  reason: string,
): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = reason?.trim() ?? ''
  if (!clean) return { error: 'Give a reason. It is what the submitter is told.' }

  const db = getDb()
  await db
    .update(submissions)
    .set({ status: 'rejected', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(submissions.id, submissionId))
  await notifySubmissionRejected(submissionId, clean)
  revalidatePath('/admin/submissions')
  return {}
}

export async function requeueSubmission(submissionId: string): Promise<void> {
  await assertAdmin()
  const db = getDb()

  // Reset to pending and re-enqueue
  await db
    .update(submissions)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(submissions.id, submissionId))

  await getSubmissionQueue().add('process-submission', { submissionId })
  revalidatePath('/admin/submissions')
}

export async function markNeedsReview(submissionId: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  await db
    .update(submissions)
    .set({ status: 'needs_review', updatedAt: new Date() })
    .where(eq(submissions.id, submissionId))
  revalidatePath('/admin/submissions')
}
