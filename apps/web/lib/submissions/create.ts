import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { submissions } from '@the-tool-pit/db'
import { getSubmissionQueue } from './queue'
import type { SubmitToolResponse } from '@the-tool-pit/types'

interface CreateSubmissionInput {
  url: string
  note?: string
  submitterIpHash: string
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

  return {
    submissionId: created.id,
    status: 'pending',
    message: "Thanks! We'll review this and add it if it's a good fit.",
  }
}
