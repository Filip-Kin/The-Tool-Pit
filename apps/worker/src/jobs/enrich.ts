import { eq } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { crawlCandidates, submissions, tools } from '@the-tool-pit/db'
import type { PipelineLogEntry } from '@the-tool-pit/db'
import { classifyCandidate } from '../pipeline/classify.js'
import { fetchGitHubRepo } from '../connectors/github.js'
import { publishCandidate } from '../pipeline/publish.js'
import { extractMetadata } from '../pipeline/extract.js'
import type { EnrichJobPayload } from '@the-tool-pit/types'

/**
 * When a re-classification decides a candidate should be suppressed, also suppress the
 * tool it was previously linked to (so it disappears from the public directory).
 * Only acts if matchedToolId is set — i.e. this candidate was the one that created the tool.
 */
async function suppressMatchedTool(matchedToolId: string, reason: string): Promise<void> {
  const db = getDb()
  await db
    .update(tools)
    .set({ status: 'suppressed', adminNotes: `Auto-suppressed on re-classification: ${reason}`, updatedAt: new Date() })
    .where(eq(tools.id, matchedToolId))
  console.log(`[enrich] suppressed tool ${matchedToolId}: ${reason}`)
}

/** Updates the originating submission record when a candidate-backed submission resolves. */
async function resolveSubmission(
  submissionId: string,
  status: 'published' | 'needs_review',
  resolvedToolId?: string,
  logMessage?: string,
): Promise<void> {
  const db = getDb()

  if (logMessage) {
    const [sub] = await db
      .select({ pipelineLog: submissions.pipelineLog })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1)
    const existingLog = (sub?.pipelineLog ?? []) as PipelineLogEntry[]
    const newEntry: PipelineLogEntry = { stage: 'enrich', status: 'warn', message: logMessage, timestamp: new Date().toISOString() }
    await db
      .update(submissions)
      .set({
        status,
        resolvedToolId: resolvedToolId ?? null,
        updatedAt: new Date(),
        pipelineLog: [...existingLog, newEntry],
      })
      .where(eq(submissions.id, submissionId))
  } else {
    await db
      .update(submissions)
      .set({ status, resolvedToolId: resolvedToolId ?? null, updatedAt: new Date() })
      .where(eq(submissions.id, submissionId))
  }
}

export async function processEnrichJob(payload: EnrichJobPayload): Promise<void> {
  const db = getDb()
  const { candidateId, submissionId, sourceType } = payload

  const [candidate] = await db
    .select()
    .from(crawlCandidates)
    .where(eq(crawlCandidates.id, candidateId))
    .limit(1)

  if (!candidate) {
    console.warn(`[enrich] candidate ${candidateId} not found`)
    return
  }

  let metadata = (candidate.rawMetadata ?? {}) as Record<string, unknown>
  const url = candidate.canonicalUrl ?? candidate.sourceUrl

  // When rescrape=true (e.g. triggered from admin "re-enrich") re-fetch the page so we
  // pick up rawHtml and any content changes since the candidate was first created.
  if (payload.rescrape) {
    const fresh = await extractMetadata(url)
    // Merge: fresh values win, but keep any existing fields the scraper didn't return
    metadata = { ...metadata, ...Object.fromEntries(Object.entries(fresh).filter(([, v]) => v !== undefined)) }
    await db
      .update(crawlCandidates)
      .set({ rawMetadata: metadata, rejectionReason: null, confidenceScore: null, classification: null, updatedAt: new Date() })
      .where(eq(crawlCandidates.id, candidateId))
    console.log(`[enrich] candidate ${candidateId}: rescraped ${url}`)
  }

  // 1. GitHub enrichment FIRST — so classification has full context (topics, description, etc.)
  let enrichedMetadata = { ...metadata }
  const githubUrl = metadata.githubUrl as string | undefined
  let githubStars = 0

  if (githubUrl) {
    const repoInfo = await fetchGitHubRepo(githubUrl)
    if (repoInfo) {
      githubStars = repoInfo.stars
      // Backfill title from repo name if missing
      if (!enrichedMetadata.title && repoInfo.fullName) {
        const repoName = repoInfo.fullName.split('/')[1] ?? repoInfo.fullName
        enrichedMetadata.title = repoName.replace(/[-_]/g, ' ')
      }
      if (!enrichedMetadata.description && repoInfo.description) {
        enrichedMetadata.description = repoInfo.description
      }
      if (repoInfo.homepage && !enrichedMetadata.homepageUrl) {
        enrichedMetadata.homepageUrl = repoInfo.homepage
      }
      // Merge topics into keywords for classifier signal
      enrichedMetadata.keywords = [
        ...((enrichedMetadata.keywords as string[]) ?? []),
        ...repoInfo.topics,
      ]
      // Store star count so publishCandidate can write it to the tool record
      enrichedMetadata.githubStars = repoInfo.stars
    }
  }

  // 2. Quality gate — suppress garbage before spending API credits on classification.
  //    Only require a title — many legitimate SPAs serve no meta description server-side.
  //    The AI classifier handles empty descriptions fine and generates its own summary.
  const qualityTitle = (enrichedMetadata.title as string | undefined) ?? ''
  if (qualityTitle.length < 3) {
    const reason = 'Low quality metadata — title missing or too short'
    await db
      .update(crawlCandidates)
      .set({ status: 'suppressed', rejectionReason: reason, updatedAt: new Date() })
      .where(eq(crawlCandidates.id, candidateId))
    console.log(`[enrich] candidate ${candidateId}: suppressed (${reason})`)
    if (submissionId) await resolveSubmission(submissionId, 'needs_review', undefined, reason)
    return
  }

  // 3. AI classification — now has full enriched context
  const classification = await classifyCandidate(
    enrichedMetadata,
    url,
  )

  // 4a. Hard-reject team websites — no point processing further
  if (classification.isTeamWebsite) {
    const reason = 'Team website — not a reusable tool'
    await db
      .update(crawlCandidates)
      .set({ classification, confidenceScore: 0, status: 'suppressed', rejectionReason: reason, updatedAt: new Date() })
      .where(eq(crawlCandidates.id, candidateId))
    console.log(`[enrich] candidate ${candidateId}: suppressed (${reason})`)
    if (candidate.matchedToolId) await suppressMatchedTool(candidate.matchedToolId, reason)
    if (submissionId) await resolveSubmission(submissionId, 'needs_review', undefined, reason)
    return
  }

  // 4. Program hard-override: GitHub topics / keywords are ground truth for program detection
  if (!classification.programs?.length) {
    const desc = (enrichedMetadata.description as string | undefined) ?? ''
    const haystack = [
      ...(enrichedMetadata.keywords as string[] ?? []),
      qualityTitle,
      desc,
    ].join(' ').toLowerCase()

    const programs: string[] = []
    if (/\bfrc\b|first\s+robotics\s+competition/.test(haystack)) programs.push('frc')
    if (/\bftc\b|first\s+tech\s+challenge/.test(haystack)) programs.push('ftc')
    if (/\bfll\b|first\s+lego\s+league/.test(haystack)) programs.push('fll')
    if (programs.length > 0) classification.programs = programs
  }

  const confidence = classification.confidence ?? 0.3

  // 3. Update candidate record
  const lowConfReason = confidence < 0.7
    ? `AI confidence too low (${Math.round(confidence * 100)}%) — requires manual review`
    : undefined
  await db
    .update(crawlCandidates)
    .set({
      rawMetadata: enrichedMetadata,
      classification,
      confidenceScore: confidence,
      // Suppress low-confidence candidates rather than publishing
      status: confidence >= 0.7 ? 'pending' : 'suppressed',
      rejectionReason: confidence >= 0.7 ? null : (lowConfReason ?? null),
      updatedAt: new Date(),
    })
    .where(eq(crawlCandidates.id, candidateId))

  // 4. Auto-publish if confidence is sufficient
  if (confidence >= 0.7) {
    const result = await publishCandidate(candidateId, sourceType)
    console.log(
      `[enrich] candidate ${candidateId}: ${result.action}` +
        (result.reason ? ` (${result.reason})` : ` (confidence=${confidence.toFixed(2)})`),
    )
    if (submissionId) {
      if (result.action === 'created') {
        await resolveSubmission(submissionId, 'published', result.toolId)
      } else {
        // 'skipped' means confidence was below threshold inside publishCandidate
        await resolveSubmission(submissionId, 'needs_review')
      }
    }
  } else {
    console.log(`[enrich] candidate ${candidateId}: suppressed (confidence=${confidence.toFixed(2)})`)
    if (candidate.matchedToolId) await suppressMatchedTool(candidate.matchedToolId, lowConfReason ?? 'confidence too low')
    if (submissionId) await resolveSubmission(submissionId, 'needs_review', undefined, lowConfReason)
  }
}
