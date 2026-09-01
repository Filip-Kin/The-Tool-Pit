import { eq } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { submissions, crawlCandidates } from '@the-tool-pit/db'
import { extractMetadata, canonicalizeUrl } from '../pipeline/extract.js'
import { checkDuplicate } from '../pipeline/deduplicate.js'
import { enrichQueue } from '../queues.js'
import type { CandidateClassification, RawCandidateMetadata, Submission } from '@the-tool-pit/db'
import type { SubmissionJobPayload } from '@the-tool-pit/types'

/**
 * A robot code / CAD submission arrives with the team number, program, season
 * and code-vs-CAD already filled in by the person who published the repo.
 * There is nothing left for a classifier to decide, and a model that reads the
 * wrong team number out of a repo name files one team's robot under another
 * team's number, which is worse than the entry being missing. So the
 * submitter's four facts become the classification verbatim.
 *
 * Same treatment the spectrum_cad and github_team_code connectors get in the
 * enrich job, and for the same reason: the source already knows.
 *
 * Returns null for a generic tool submission, which still goes to the AI.
 */
function classificationFromSubmitter(
  submission: Submission,
  metadata: RawCandidateMetadata,
): CandidateClassification | null {
  if (!submission.artifactKind || submission.teamNumber == null) return null

  const isCad = submission.artifactKind === 'cad'
  const title = metadata.title ?? ''
  const description = metadata.description ?? ''

  return {
    toolType: 'github_project',
    programs: [submission.program ?? 'frc'],
    isTeamCode: !isCad,
    isTeamCad: isCad,
    teamNumber: submission.teamNumber,
    seasonYear: submission.seasonYear,
    summary: (description || title).slice(0, 300),
    // No confidence score. A person typed this, so there is no model estimate
    // to record, and a number here would let the auto-publish threshold fire on
    // something a human has not looked at.
    reasoning: `Team ${submission.teamNumber} ${isCad ? 'CAD' : 'robot code'} for ${submission.seasonYear ?? 'an unstated season'}, stated by the submitter`,
  }
}

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

  const submitterClassification = classificationFromSubmitter(submission, metadata)

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
        classification: submitterClassification,
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
        classification: submitterClassification,
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
      // A submitter-classified candidate stops here: it is waiting on a person,
      // not on the pipeline, and 'processing' would leave it sitting in a tab
      // nobody watches. needs_review is the tab that shows an alert count and
      // renders a link straight to the candidate.
      ...(submitterClassification ? { status: 'needs_review' as const } : {}),
      updatedAt: new Date(),
      pipelineLog: [
        ...(submission.pipelineLog ?? []),
        {
          stage: 'extract',
          status: 'ok' as const,
          message: `Extracted metadata; candidate ${candidateId} ${existingCandidate ? 'reset' : 'created'}`,
          timestamp: new Date().toISOString(),
        },
        ...(submitterClassification
          ? [
              {
                stage: 'classify',
                status: 'skip' as const,
                message: `Team facts taken from the submitter, not inferred: ${submitterClassification.reasoning}`,
                timestamp: new Date().toISOString(),
              },
            ]
          : []),
      ],
    })
    .where(eq(submissions.id, submissionId))

  // Team code / CAD never reaches enrichment, so it can never auto-publish.
  // The candidate carries the submitter's team number, season and kind, and an
  // admin approving it in /admin/candidates writes them straight onto the tool.
  if (submitterClassification) {
    console.log(`[submission] ${submissionId} → candidate ${candidateId} awaiting review (team ${submitterClassification.teamNumber})`)
    return
  }

  // Enqueue for AI enrichment + publish decision (same path as crawled tools).
  // Pass submissionId so the enrich job can update the submission status when done.
  await enrichQueue.add('enrich', { candidateId, submissionId })

  console.log(`[submission] ${submissionId} → candidate ${candidateId} queued for enrichment`)
}
