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
            message: `Duplicate detected via ${dupeCheck.method ?? 'url_exact'}${dupeCheck.matchedToolId ? ` (tool: ${dupeCheck.matchedToolId})` : dupeCheck.matchedCandidateId ? ` (candidate: ${dupeCheck.matchedCandidateId})` : ''}${dupeCheck.matchedUrl ? ` — matched URL: ${dupeCheck.matchedUrl}` : ''}`,
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

  // Upsert crawl candidate — reuse existing record on requeue rather than creating duplicates
  const [existingCandidate] = await db
    .select({ id: crawlCandidates.id })
    .from(crawlCandidates)
    .where(eq(crawlCandidates.canonicalUrl, canonicalUrl))
    .limit(1)

  let candidateId: string
  if (existingCandidate) {
    await db
      .update(crawlCandidates)
      .set({
        rawMetadata: metadata,
        status: 'pending',
        rejectionReason: null,
        confidenceScore: null,
        classification: null,
        submissionId: submissionId,
        updatedAt: new Date(),
      })
      .where(eq(crawlCandidates.id, existingCandidate.id))
    candidateId = existingCandidate.id
  } else {
    const [candidate] = await db
      .insert(crawlCandidates)
      .values({
        sourceUrl: submission.url,
        canonicalUrl,
        rawMetadata: metadata,
        status: 'pending',
        submissionId: submissionId,
      })
      .returning({ id: crawlCandidates.id })
    candidateId = candidate.id
  }

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
          message: `Extracted metadata; candidate ${candidateId} ${existingCandidate ? 'reset' : 'created'}`,
          timestamp: new Date().toISOString(),
        },
      ],
    })
    .where(eq(submissions.id, submissionId))

  // Enqueue for AI enrichment + publish decision (same path as crawled tools).
  // Pass submissionId so the enrich job can update the submission status when done.
  await enrichQueue.add('enrich', { candidateId, submissionId })

  console.log(`[submission] ${submissionId} → candidate ${candidateId} queued for enrichment`)
}
