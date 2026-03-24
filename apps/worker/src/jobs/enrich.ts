import { eq } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { crawlCandidates } from '@the-tool-pit/db'
import { classifyCandidate } from '../pipeline/classify.js'
import { fetchGitHubRepo } from '../connectors/github.js'
import { publishCandidate } from '../pipeline/publish.js'
import type { EnrichJobPayload } from '@the-tool-pit/types'

export async function processEnrichJob(payload: EnrichJobPayload): Promise<void> {
  const db = getDb()
  const { candidateId } = payload

  const [candidate] = await db
    .select()
    .from(crawlCandidates)
    .where(eq(crawlCandidates.id, candidateId))
    .limit(1)

  if (!candidate) {
    console.warn(`[enrich] candidate ${candidateId} not found`)
    return
  }

  const metadata = (candidate.rawMetadata ?? {}) as Record<string, unknown>
  const url = candidate.canonicalUrl ?? candidate.sourceUrl

  // 1. AI classification (Haiku, background, non-blocking for UI)
  const classification = await classifyCandidate(
    candidate.rawMetadata ?? {},
    url,
  )

  // 2. GitHub enrichment — fetch repo details for richer metadata
  let enrichedMetadata = { ...metadata }
  const githubUrl = metadata.githubUrl as string | undefined

  if (githubUrl) {
    const repoInfo = await fetchGitHubRepo(githubUrl)
    if (repoInfo) {
      if (!enrichedMetadata.description && repoInfo.description) {
        enrichedMetadata.description = repoInfo.description
      }
      if (repoInfo.homepage && !enrichedMetadata.homepageUrl) {
        enrichedMetadata.homepageUrl = repoInfo.homepage
      }
      enrichedMetadata.keywords = [
        ...((enrichedMetadata.keywords as string[]) ?? []),
        ...repoInfo.topics,
      ]
    }
  }

  const confidence = classification.confidence ?? 0.3

  // 3. Update candidate record
  await db
    .update(crawlCandidates)
    .set({
      rawMetadata: enrichedMetadata,
      classification,
      confidenceScore: confidence,
      // Suppress low-confidence candidates rather than publishing
      status: confidence >= 0.7 ? 'pending' : 'suppressed',
      updatedAt: new Date(),
    })
    .where(eq(crawlCandidates.id, candidateId))

  // 4. Auto-publish if confidence is sufficient
  if (confidence >= 0.7) {
    const result = await publishCandidate(candidateId)
    console.log(
      `[enrich] candidate ${candidateId}: ${result.action}` +
        (result.reason ? ` (${result.reason})` : ` (confidence=${confidence.toFixed(2)})`),
    )
  } else {
    console.log(`[enrich] candidate ${candidateId}: suppressed (confidence=${confidence.toFixed(2)})`)
  }
}
