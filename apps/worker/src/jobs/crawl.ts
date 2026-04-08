import { getDb } from '@the-tool-pit/db'
import { crawlJobs, crawlCandidates } from '@the-tool-pit/db'
import { eq } from 'drizzle-orm'
import { FtaToolsConnector } from '../connectors/fta-tools.js'
import { VolunteerSystemsConnector } from '../connectors/volunteer-systems.js'
import { GitHubTopicsConnector } from '../connectors/github-topics.js'
import { AwesomeListConnector } from '../connectors/awesome-list.js'
import { extractMetadata, canonicalizeUrl } from '../pipeline/extract.js'
import { checkDuplicateByUrl, checkDuplicateByName } from '../pipeline/deduplicate.js'
import { enrichQueue } from '../queues.js'
import { delay } from '../connectors/base.js'
import type { CrawlJobPayload } from '@the-tool-pit/types'

const CONNECTOR_REGISTRY: Record<string, () => { run(): Promise<{ candidates: unknown[]; stats: unknown }> }> = {
  fta_tools: () => new FtaToolsConnector(),
  volunteer_systems: () => new VolunteerSystemsConnector(),
  github_topics: () => new GitHubTopicsConnector(),
  awesome_list: () => new AwesomeListConnector(),
}

export async function processCrawlJob(payload: CrawlJobPayload): Promise<void> {
  const db = getDb()
  const { connector: connectorName } = payload

  const factory = CONNECTOR_REGISTRY[connectorName]
  if (!factory) {
    throw new Error(`Unknown connector: ${connectorName}`)
  }

  // Create a crawl job record so the admin can track it
  const [jobRecord] = await db
    .insert(crawlJobs)
    .values({ connector: connectorName, status: 'running', startedAt: new Date() })
    .returning({ id: crawlJobs.id })

  const jobId = jobRecord.id
  let totalNew = 0
  let totalSkipped = 0
  let totalFailed = 0

  try {
    const connector = factory()

    if ('disabled' in connector && connector.disabled) {
      console.log(`[crawl] connector ${connectorName} is disabled — skipping`)
      await db
        .update(crawlJobs)
        .set({ status: 'done', finishedAt: new Date(), stats: { discovered: 0, new: 0, updated: 0, skipped: 0, failed: 0 } })
        .where(eq(crawlJobs.id, jobId))
      return
    }

    const result = await connector.run()
    const candidates = result.candidates as Array<Record<string, string | undefined>>

    for (const candidate of candidates) {
      try {
        const rawUrl = candidate.canonicalUrl ?? candidate.sourceUrl ?? ''
        if (!rawUrl) continue

        const canonicalUrl = canonicalizeUrl(rawUrl)

        // 1. URL dedup (no metadata needed, no delay)
        const urlDupe = await checkDuplicateByUrl(canonicalUrl)
        if (urlDupe.isDuplicate) {
          totalSkipped++
          continue
        }

        // 2. Fetch metadata first, THEN name dedup
        await delay(500)
        const metadata = await extractMetadata(canonicalUrl)

        const resolvedTitle = metadata.title || candidate.title
        if (resolvedTitle) {
          const nameDupe = await checkDuplicateByName(resolvedTitle as string)
          if (nameDupe.isDuplicate) {
            totalSkipped++
            continue
          }
        }

        // Persist the candidate
        const [stored] = await db
          .insert(crawlCandidates)
          .values({
            jobId,
            sourceUrl: candidate.sourceUrl ?? canonicalUrl,
            canonicalUrl,
            rawMetadata: {
              ...metadata,
              // Prefer extracted data; fall back to connector-supplied
              title: metadata.title || candidate.title,
              description: metadata.description || candidate.description,
              githubUrl: metadata.githubUrl || candidate.githubUrl,
              homepageUrl: metadata.homepageUrl || candidate.homepageUrl,
              // Merge keyword arrays: connector-supplied keywords (topics, section context)
              // are especially valuable for GitHub topics connector
              keywords: [
                ...new Set([
                  ...(metadata.keywords ?? []),
                  ...(candidate.keywords ?? []),
                ]),
              ],
            },
            status: 'pending',
          })
          .returning({ id: crawlCandidates.id })

        // Enqueue for AI enrichment + publish decision
        await enrichQueue.add('enrich', { candidateId: stored.id, sourceType: connectorName })
        totalNew++
      } catch (err) {
        totalFailed++
        console.error('[crawl] error processing candidate:', err)
      }
    }

    await db
      .update(crawlJobs)
      .set({
        status: 'done',
        finishedAt: new Date(),
        stats: {
          discovered: candidates.length,
          new: totalNew,
          updated: 0,
          skipped: totalSkipped,
          failed: totalFailed,
        },
      })
      .where(eq(crawlJobs.id, jobId))

    console.log(
      `[crawl] ${connectorName} done: ${totalNew} new, ${totalSkipped} skipped, ${totalFailed} failed`,
    )
  } catch (err) {
    await db
      .update(crawlJobs)
      .set({ status: 'failed', finishedAt: new Date(), error: String(err) })
      .where(eq(crawlJobs.id, jobId))
    throw err
  }
}
