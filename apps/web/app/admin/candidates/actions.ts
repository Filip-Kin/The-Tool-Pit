'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { submissions } from '@the-tool-pit/db'
import { adminIdentity } from '@/lib/admin/auth'
import { approveCandidateBody, suppressCandidateBody } from '@/lib/admin/candidate-decisions'
import { recordDiscordDecision, submissionIdForCandidate, submissionVertical } from '@/lib/discord/decisions'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

export async function approveCandidate(candidateId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const result = await approveCandidateBody(candidateId)
  revalidatePath('/admin/candidates')
  revalidatePath(`/admin/candidates/${candidateId}`)
  revalidatePath('/admin/tools')
  revalidatePath('/admin/submissions')
  if (result.error) return { error: result.error }
  await markSubmissionPost(candidateId, 'approved')
  return {}
}

/**
 * The approvals-channel post for a candidate is keyed on the submission it
 * came from (that is the only row that existed when it was announced). A
 * crawled candidate has no submission, was never announced, and this is a
 * quiet no-op.
 */
async function markSubmissionPost(candidateId: string, status: 'approved' | 'rejected'): Promise<void> {
  const submissionId = await submissionIdForCandidate(candidateId)
  if (!submissionId) return
  const [sub] = await getDb().select({ artifactKind: submissions.artifactKind }).from(submissions).where(eq(submissions.id, submissionId)).limit(1)
  await recordDiscordDecision(submissionVertical(sub?.artifactKind), submissionId, { status, by: await adminIdentity(), via: 'site' })
}

/**
 * Refuse a candidate, or take down the listing it already produced.
 *
 * Same double duty as the field and event queues. A candidate that reached
 * 'published' has a tool in the directory people can find, and suppressing it
 * is a takedown, so the status is read before it is written and the email says
 * which of the two happened. The reason is required: it is that email.
 */
export async function suppressCandidate(
  candidateId: string,
  rejectionReason: string,
): Promise<{ error?: string }> {
  await assertAdmin()
  const result = await suppressCandidateBody(candidateId, rejectionReason)
  if (result.error) return result
  await markSubmissionPost(candidateId, 'rejected')
  revalidatePath('/admin/candidates')
  revalidatePath(`/admin/candidates/${candidateId}`)
  revalidatePath('/admin/submissions')
  return {}
}
