import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { submissions } from '@the-tool-pit/db'
import { getSubmissionQueue } from './queue'
import { sendApprovalNotice, reviewSubmissionUrl, type SubmitToolResponse } from '@the-tool-pit/types'

interface CreateSubmissionInput {
  url: string
  note?: string
  submitterIpHash: string
  /**
   * The signed-in user, when there was one. Optional on purpose: sign-in is
   * never a wall in front of a submission. It only buys attribution and an
   * email when a moderator gets to it.
   */
  submittedByUserId?: string
  /**
   * What the "just passing it along" box said, resolved by the route with
   * lib/listings/passing-along.ts. NULL for a signed-out submitter, TRUE means
   * the listing is theirs when a moderator approves it.
   */
  submitterOwns?: boolean | null
}

/**
 * Records a submission and queues it for pipeline processing.
 * The actual processing is done by the worker service.
 */
export async function createSubmission(input: CreateSubmissionInput): Promise<SubmitToolResponse> {
  const db = getDb()

  // Check for recent duplicate URL
  const [existing] = await db
    .select({ id: submissions.id, status: submissions.status, resolvedToolId: submissions.resolvedToolId })
    .from(submissions)
    .where(eq(submissions.url, input.url))
    .limit(1)

  if (existing && existing.status === 'published' && existing.resolvedToolId) {
    return {
      submissionId: existing.id,
      status: 'duplicate',
      message: 'This tool is already listed.',
    }
  }

  const [created] = await db
    .insert(submissions)
    .values({
      url: input.url,
      submitterNote: input.note,
      submitterIpHash: input.submitterIpHash,
      submittedByUserId: input.submittedByUserId ?? null,
      submitterOwns: input.submitterOwns ?? null,
      status: 'pending',
      pipelineLog: [
        {
          stage: 'received',
          status: 'ok',
          message: 'Submission queued for review',
          timestamp: new Date().toISOString(),
        },
      ],
    })
    .returning({ id: submissions.id })

  // Enqueue worker job — worker handles extract → classify → publish
  await getSubmissionQueue().add('process-submission', { submissionId: created.id })

  // NEWLY WIRED. The oldest submit form on the site and the only one that never
  // pinged anybody: a tool submitted here sat in the queue until somebody
  // thought to open it.
  sendApprovalNotice({
    vertical: 'tool',
    title: input.url,
    reviewUrl: reviewSubmissionUrl(created.id),
    sourceUrl: input.url,
    facts: [{ label: 'Note', value: input.note ?? null }],
  })

  return {
    submissionId: created.id,
    status: 'pending',
    message: "Thanks! We'll review this and add it if it's a good fit.",
  }
}
