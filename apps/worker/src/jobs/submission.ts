import { eq } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { submissions, crawlCandidates } from '@the-tool-pit/db'
import { extractMetadata, canonicalizeUrl } from '../pipeline/extract.js'
import { checkDuplicate } from '../pipeline/deduplicate.js'
import { enrichQueue } from '../queues.js'
import type { SubmissionJobPayload } from '@the-tool-pit/types'

export async function processSubmissionJob(payload: SubmissionJobPayload): Promise<void> {
  const db = getDb()
  const { submissionId } = payload

  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1)

  if (!submission) {
    console.warn(`[submission] ${submissionId} not found`)
    return
  }

  // Mark as processing
  await db
    .update(submissions)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(eq(submissions.id, submissionId))

  const canonicalUrl = canonicalizeUrl(submission.url)

  // Check for duplicate against existing tools and candidates
  const dupeCheck = await checkDuplicate(canonicalUrl)
  if (dupeCheck.isDuplicate) {
    await db
      .update(submissions)
      .set({
        status: 'duplicate',
        resolvedToolId: dupeCheck.matchedToolId ?? null,
        updatedAt: new Date(),
        pipelineLog: [
          ...(submission.pipelineLog ?? []),
          {
            stage: 'deduplicate',
            status: 'warn' as const,
            message: `Duplicate detected via ${dupeCheck.method ?? 'url_exact'}`,
            timestamp: new Date().toISOString(),
          },
        ],
      })
      .where(eq(submissions.id, submissionId))
    console.log(`[submission] ${submissionId} marked duplicate (${dupeCheck.method})`)
    return
  }

  // Extract page metadata
  const metadata = await extractMetadata(canonicalUrl)

  // Create a crawl candidate so the standard enrich pipeline can process it
  const [candidate] = await db
    .insert(crawlCandidates)
    .values({
      sourceUrl: submission.url,
      canonicalUrl,
      rawMetadata: metadata,
      status: 'pending',
    })
    .returning({ id: crawlCandidates.id })

  // Update submission with log entry
  await db
    .update(submissions)
    .set({
      updatedAt: new Date(),
      pipelineLog: [
        ...(submission.pipelineLog ?? []),
        {
          stage: 'extract',
          status: 'ok' as const,
          message: `Extracted metadata; candidate ${candidate.id} created`,
          timestamp: new Date().toISOString(),
        },
      ],
    })
    .where(eq(submissions.id, submissionId))

  // Enqueue for AI enrichment + publish decision (same path as crawled tools).
  // Pass submissionId so the enrich job can update the submission status when done.
  await enrichQueue.add('enrich', { candidateId: candidate.id, submissionId })

  console.log(`[submission] ${submissionId} → candidate ${candidate.id} queued for enrichment`)
}
