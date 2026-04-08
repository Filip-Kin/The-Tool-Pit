/**
 * Worker entrypoint.
 * Starts BullMQ workers for all queues and schedules recurring jobs.
 * Run with: bun --env-file=../../.env src/index.ts
 */
import { Worker } from 'bullmq'
import { getRedis } from './redis.js'
import { scheduleRecurringJobs } from './queues.js'
import { processCrawlJob } from './jobs/crawl.js'
import { processEnrichJob } from './jobs/enrich.js'
import { processFreshnessJob } from './jobs/freshness.js'
import { processLinkCheckerJob } from './jobs/link-checker.js'
import { processReindexJob } from './jobs/reindex.js'
import { processSubmissionJob } from './jobs/submission.js'
import type { CrawlJobPayload, EnrichJobPayload, FreshnessCheckPayload, LinkCheckPayload, ReindexPayload, SubmissionJobPayload } from '@the-tool-pit/types'

const connection = getRedis()
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10)

const crawlWorker = new Worker<CrawlJobPayload>(
  'crawl',
  async (job) => {
    console.log(`[crawl] processing job ${job.id} connector=${job.data.connector}`)
    await processCrawlJob(job.data)
  },
  { connection, concurrency: CONCURRENCY },
)

const enrichWorker = new Worker<EnrichJobPayload>(
  'enrich',
  async (job) => {
    console.log(`[enrich] processing candidate ${job.data.candidateId}`)
    await processEnrichJob(job.data)
  },
  { connection, concurrency: CONCURRENCY },
)

const freshnessWorker = new Worker<FreshnessCheckPayload>(
  'freshness',
  async (job) => {
    console.log(`[freshness] checking tool ${job.data.toolId}`)
    await processFreshnessJob(job.data)
  },
  { connection, concurrency: 4 },
)

const linkCheckWorker = new Worker<LinkCheckPayload>(
  'link-check',
  async (job) => {
    console.log(`[link-check] checking tool ${job.data.toolId}`)
    await processLinkCheckerJob(job.data)
  },
  { connection, concurrency: 4 },
)

const reindexWorker = new Worker<ReindexPayload>(
  'reindex',
  async (job) => {
    console.log(`[reindex] processing job ${job.id} toolId=${job.data.toolId ?? 'all'}`)
    await processReindexJob(job.data)
  },
  { connection, concurrency: 1 },
)

const submissionWorker = new Worker<SubmissionJobPayload>(
  'submission',
  async (job) => {
    console.log(`[submission] processing submission ${job.data.submissionId}`)
    await processSubmissionJob(job.data)
  },
  { connection, concurrency: CONCURRENCY },
)

// Log worker errors without crashing
for (const worker of [crawlWorker, enrichWorker, freshnessWorker, linkCheckWorker, reindexWorker, submissionWorker]) {
  worker.on('failed', (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err.message)
  })
  worker.on('error', (err) => {
    console.error('[worker] error:', err.message)
  })
}

// Schedule recurring jobs
scheduleRecurringJobs().then(() => {
  console.log('[worker] recurring jobs scheduled')
})

console.log(`[worker] started with concurrency=${CONCURRENCY}`)

// Graceful shutdown
async function shutdown() {
  console.log('[worker] shutting down…')
  await Promise.all([
    crawlWorker.close(),
    enrichWorker.close(),
    freshnessWorker.close(),
    linkCheckWorker.close(),
    reindexWorker.close(),
    submissionWorker.close(),
  ])
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
