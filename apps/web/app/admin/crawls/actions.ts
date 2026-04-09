'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
import { getRedis } from '@/lib/redis'
import { getDb } from '@/lib/db'
import { crawlCandidates, submissions } from '@the-tool-pit/db'
import type {
  CrawlJobPayload,
  EnrichJobPayload,
  FreshnessCheckPayload,
  ReindexPayload,
  SubmissionJobPayload,
} from '@the-tool-pit/types'

async function assertAdmin() {
  const cookieStore = await cookies()
  const authed = cookieStore.get('admin_token')?.value === process.env.ADMIN_SECRET
  if (!authed) redirect('/admin/login')
}

function getQueue<T>(name: string) {
  return new Queue<T>(name, {
    connection: getRedis(),
    defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 200 } },
  })
}

/** Trigger a crawl for one of the registered connectors. */
export async function triggerCrawl(connector: string): Promise<{ error?: string }> {
  await assertAdmin()

  const VALID_CONNECTORS = [
    'fta_tools',
    'volunteer_systems',
    'github_topics',
    'awesome_list',
    'chief_delphi',
    'tba_teams',
  ] as const

  if (!VALID_CONNECTORS.includes(connector as (typeof VALID_CONNECTORS)[number])) {
    return { error: `Unknown connector: ${connector}` }
  }

  try {
    const queue = getQueue<CrawlJobPayload>('crawl')
    await queue.add('crawl', { connector, jobId: '' })
    revalidatePath('/admin/crawls')
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}

/** Queue a freshness check for ALL published tools. */
export async function triggerFreshnessCheckAll(): Promise<{ error?: string }> {
  await assertAdmin()

  try {
    const queue = getQueue<FreshnessCheckPayload>('freshness')
    await queue.add('check-freshness', { toolId: '__all__' })
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}

/**
 * Re-scrape and re-enrich every suppressed candidate using the latest pipeline.
 * Resets their status to pending and enqueues an enrich job with rescrape=true.
 */
export async function triggerReEnrichSuppressed(): Promise<{ error?: string; count?: number }> {
  await assertAdmin()
  const db = getDb()

  try {
    const suppressed = await db
      .select({ id: crawlCandidates.id, submissionId: crawlCandidates.submissionId })
      .from(crawlCandidates)
      .where(eq(crawlCandidates.status, 'suppressed'))

    const queue = getQueue<EnrichJobPayload>('enrich')
    for (const c of suppressed) {
      await db
        .update(crawlCandidates)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(crawlCandidates.id, c.id))
      await queue.add('enrich', {
        candidateId: c.id,
        submissionId: c.submissionId ?? undefined,
        rescrape: true,
      })
    }

    revalidatePath('/admin/candidates')
    return { count: suppressed.length }
  } catch (err) {
    return { error: String(err) }
  }
}

/**
 * Requeue every needs_review submission through the full pipeline.
 * This re-scrapes the URL, picks up rawHtml, and re-classifies.
 */
export async function triggerRequeueNeedsReview(): Promise<{ error?: string; count?: number }> {
  await assertAdmin()
  const db = getDb()

  try {
    const needsReview = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.status, 'needs_review'))

    const queue = getQueue<SubmissionJobPayload>('submission')
    for (const s of needsReview) {
      await db
        .update(submissions)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(submissions.id, s.id))
      await queue.add('process-submission', { submissionId: s.id })
    }

    revalidatePath('/admin/submissions')
    return { count: needsReview.length }
  } catch (err) {
    return { error: String(err) }
  }
}

/** Rebuild PostgreSQL full-text + trigram search indexes. */
export async function triggerReindex(): Promise<{ error?: string }> {
  await assertAdmin()

  try {
    const queue = getQueue<ReindexPayload>('reindex')
    await queue.add('reindex', {})
    return {}
  } catch (err) {
    return { error: String(err) }
  }
}

/**
 * Re-scrape and re-classify every published candidate using the latest pipeline.
 * Resets their status to pending and enqueues an enrich job with rescrape=true.
 */
export async function triggerReEnrichPublished(): Promise<{ error?: string; count?: number }> {
  await assertAdmin()
  const db = getDb()

  try {
    const published = await db
      .select({ id: crawlCandidates.id, submissionId: crawlCandidates.submissionId })
      .from(crawlCandidates)
      .where(eq(crawlCandidates.status, 'published'))

    const queue = getQueue<EnrichJobPayload>('enrich')
    for (const c of published) {
      await db
        .update(crawlCandidates)
        .set({
          status: 'pending',
          classification: null,
          confidenceScore: null,
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(crawlCandidates.id, c.id))
      await queue.add('enrich', {
        candidateId: c.id,
        submissionId: c.submissionId ?? undefined,
        rescrape: true,
      })
    }

    revalidatePath('/admin/candidates')
    return { count: published.length }
  } catch (err) {
    return { error: String(err) }
  }
}
