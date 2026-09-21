import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { crawlCandidates, submissions } from '@the-tool-pit/db'
import { adminPublishCandidate } from '@/lib/admin/publish-candidate'
import { notifyToolPublished, notifyToolCandidateRejected } from '@/lib/notify/approvals'
import { grantToolOwnership } from '@/lib/listings/submitter-ownership'

/**
 * Tool candidate decisions. One body each for the admin buttons and for a
 * reaction in Discord, so both write the same rows. Know nothing about
 * sessions or cache revalidation; the caller does those.
 */

/** Publish a candidate as a tool, hand it to its submitter, tell them, close the submission. */
export async function approveCandidateBody(candidateId: string): Promise<{ error?: string; toolId?: string }> {
  const result = await adminPublishCandidate(candidateId)
  if ('error' in result) return { error: result.error }
  // Only a candidate that came from a public submission has anyone to tell. One
  // found by a crawler falls straight through this without a query. Same for
  // ownership: nobody submitted a crawled tool, so nobody gets it.
  await grantToolOwnership(candidateId, result.toolId)
  await notifyToolPublished(candidateId, result.toolId)
  // The submission this candidate came from is done too. It sat in "Needs
  // review" after its candidate was published because nothing told it.
  await resolveSubmissionForCandidate(candidateId, { status: 'published', resolvedToolId: result.toolId })
  return { toolId: result.toolId }
}

/**
 * Refuse a candidate, or take down the listing it already produced.
 *
 * Same double duty as the field and event queues. A candidate that reached
 * 'published' has a tool in the directory people can find, and suppressing it
 * is a takedown, so the status is read before it is written and the email says
 * which of the two happened. The reason is required: it is that email.
 */
export async function suppressCandidateBody(candidateId: string, rejectionReason: string): Promise<{ error?: string }> {
  const clean = rejectionReason?.trim() ?? ''
  if (!clean) return { error: 'Give a reason. It is what the submitter is told.' }

  const db = getDb()
  const [before] = await db
    .select({ status: crawlCandidates.status })
    .from(crawlCandidates)
    .where(eq(crawlCandidates.id, candidateId))
    .limit(1)
  if (!before) return { error: 'Candidate not found' }

  await db
    .update(crawlCandidates)
    .set({ status: 'suppressed', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(crawlCandidates.id, candidateId))
  // Only a candidate that came from a public submission has anyone to tell.
  await notifyToolCandidateRejected(candidateId, before.status === 'published', clean)
  await resolveSubmissionForCandidate(candidateId, { status: 'rejected', reason: clean })
  return {}
}

/**
 * A candidate that came from a public submission carries the submission's
 * id. When the candidate is decided, the submission is decided: published
 * with the tool it became, or rejected with the reason the submitter was
 * given. A crawled candidate has no submission and this is a no-op.
 */
export async function resolveSubmissionForCandidate(
  candidateId: string,
  outcome: { status: 'published'; resolvedToolId: string } | { status: 'rejected'; reason: string },
): Promise<void> {
  const db = getDb()
  const [cand] = await db.select({ submissionId: crawlCandidates.submissionId }).from(crawlCandidates).where(eq(crawlCandidates.id, candidateId)).limit(1)
  if (!cand?.submissionId) return
  await db
    .update(submissions)
    .set(
      outcome.status === 'published'
        ? { status: 'published', resolvedToolId: outcome.resolvedToolId, updatedAt: new Date() }
        : { status: 'rejected', rejectionReason: outcome.reason, updatedAt: new Date() },
    )
    .where(eq(submissions.id, cand.submissionId))
}

/**
 * The candidate the worker made of a submission, if it has made one yet. A ✅
 * on a tool post arrives keyed on the submission; this is how it finds the
 * thing that can actually be published. Null while the pipeline is still
 * running, or when the submission was a duplicate and never became one.
 */
export async function candidateIdForSubmission(submissionId: string): Promise<string | null> {
  const [cand] = await getDb()
    .select({ id: crawlCandidates.id })
    .from(crawlCandidates)
    .where(eq(crawlCandidates.submissionId, submissionId))
    .limit(1)
  return cand?.id ?? null
}
