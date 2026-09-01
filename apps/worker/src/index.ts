/**
 * Worker entrypoint.
 * Starts BullMQ workers for all queues and schedules recurring jobs.
 * Run with: bun --env-file=../../.env src/index.ts
 */
import { Worker } from 'bullmq'
import { getRedis } from './redis.js'
import { scheduleRecurringJobs, grantEnrichQueue, grantMonitorQueue } from './queues.js'
import { processCrawlJob } from './jobs/crawl.js'
import { processEnrichJob } from './jobs/enrich.js'
import { processFreshnessJob } from './jobs/freshness.js'
import { processLinkCheckerJob } from './jobs/link-checker.js'
import { processReindexJob } from './jobs/reindex.js'
import { processSubmissionJob } from './jobs/submission.js'
import { processAlbumIngestJob } from './jobs/album-ingest.js'
import { processAlbumEnrichJob } from './jobs/album-enrich.js'
import { processGrantDiscoverJob } from './grants/discover.js'
import { processGrantEnrichJob } from './grants/enrich.js'
import { processGrantMonitorJob } from './grants/monitor.js'
import { processGrantMatchJob } from './grants/matcher.js'
import { processGrantAlertDrainJob } from './grants/alerts.js'
import { processNotificationDrainJob } from './notifications/outbox.js'
import { processGrantDeadlineSweepJob } from './grants/deadline-sweeper.js'
import { enqueueDueGrantMonitors } from './grants/cadence.js'
import { sendApprovalNotice, reviewQueueUrl } from '@the-tool-pit/types'
import { processListingDiscoverJob } from './listings/discover.js'
import { processSeasonRenewalJob } from './listings/season-renewal.js'
import type { CrawlJobPayload, EnrichJobPayload, FreshnessCheckPayload, LinkCheckPayload, ReindexPayload, SubmissionJobPayload, AlbumIngestPayload, AlbumEnrichPayload } from '@the-tool-pit/types'
import type { GrantDiscoverPayload } from './grants/discover.js'
import type { GrantEnrichPayload } from './grants/enrich.js'
import type { GrantMonitorPayload } from './grants/monitor.js'
import type { GrantMatchJobPayload } from './grants/matcher.js'
import type { ListingDiscoverPayload } from './listings/discover.js'

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

const albumIngestWorker = new Worker<AlbumIngestPayload>(
  'album-ingest',
  async (job) => {
    console.log(`[album-ingest] processing job ${job.id} connector=${job.data.connector}`)
    await processAlbumIngestJob(job.data)
  },
  { connection, concurrency: CONCURRENCY },
)

const albumEnrichWorker = new Worker<AlbumEnrichPayload>(
  'album-enrich',
  async (job) => {
    console.log(`[album-enrich] processing candidate ${job.data.candidateId}`)
    await processAlbumEnrichJob(job.data)
  },
  { connection, concurrency: CONCURRENCY },
)

// #region grants

const grantDiscoverWorker = new Worker<GrantDiscoverPayload>(
  'grant-discover',
  async (job) => {
    console.log(`[grant-discover] processing job ${job.id} connector=${job.data.connector}`)
    const outcome = await processGrantDiscoverJob(job.data)

    // discover.ts returns the ids and deliberately enqueues nothing itself, so
    // the chain to classification is closed here, where the queue handles live.
    for (const candidateId of outcome.insertedCandidateIds) {
      await grantEnrichQueue.add('grant-enrich', { candidateId })
    }

    // A capped run and a complete run look identical in the logs otherwise, and
    // a silent cap reads as "we found everything there is".
    if (outcome.stats.limits.length > 0) {
      console.warn(`[grant-discover] ${outcome.connector} coverage limits: ${outcome.stats.limits.join('; ')}`)
    }
    for (const err of outcome.stats.errors) {
      console.error(`[grant-discover] ${outcome.connector} error: ${err}`)
    }
    console.log(
      `[grant-discover] ${outcome.connector} queued ${outcome.insertedCandidateIds.length} candidates for enrichment`,
    )

    // ONE SUMMARY PER RUN, not one per candidate: a discovery pass files
    // dozens, and a message each would bury the human submissions this channel
    // exists for. A run that found nothing says nothing.
    const found = outcome.insertedCandidateIds.length
    if (found > 0) {
      sendApprovalNotice({
        vertical: 'crawl',
        title: `${outcome.connector} found ${found} new grant lead${found === 1 ? '' : 's'}`,
        reviewUrl: reviewQueueUrl('/admin/grants/candidates?status=pending'),
        description: `${found} candidate${found === 1 ? '' : 's'} waiting in the grants queue.`,
        facts: [
          { label: 'Connector', value: outcome.connector, inline: true },
          { label: 'New', value: found, inline: true },
          // A capped run and a complete run look identical otherwise, and a
          // silent cap reads as "we found everything there is".
          { label: 'Coverage limits', value: outcome.stats.limits.join('; ') || null },
          { label: 'Errors', value: outcome.stats.errors.slice(0, 3).join('; ') || null },
        ],
      })
    }
  },
  { connection, concurrency: CONCURRENCY },
)

const grantEnrichWorker = new Worker<GrantEnrichPayload>(
  'grant-enrich',
  async (job) => {
    console.log(`[grant-enrich] processing candidate ${job.data.candidateId}`)
    await processGrantEnrichJob(job.data)
  },
  // One Haiku call per job. Low concurrency keeps a discovery run that inserted
  // a few hundred candidates from emptying a pay-as-you-go balance in a minute.
  { connection, concurrency: 2 },
)

const grantMonitorWorker = new Worker<GrantMonitorPayload>(
  'grant-monitor',
  async (job) => {
    // Due-check sentinel, same shape as the freshness pass. cadence.ts returns
    // the ids and does no enqueueing, so the fan-out happens here.
    if (job.data.grantId === '__all__') {
      const dueIds = await enqueueDueGrantMonitors()
      for (const grantId of dueIds) {
        await grantMonitorQueue.add(
          'grant-monitor',
          { grantId },
          // Spread over five minutes. These are funders' own web servers, and a
          // few hundred simultaneous requests from one IP is how a directory
          // gets itself blocked.
          { delay: Math.floor(Math.random() * 300_000) },
        )
      }
      console.log(`[grant-monitor] queued ${dueIds.length} due grants`)
      return
    }

    console.log(`[grant-monitor] checking grant ${job.data.grantId}`)
    await processGrantMonitorJob(job.data)
  },
  { connection, concurrency: 3 },
)

const grantMatchWorker = new Worker<GrantMatchJobPayload>(
  'grant-match',
  async (job) => {
    console.log(`[grant-match] matching profile ${job.data.profileId}`)
    await processGrantMatchJob(job.data)
  },
  { connection, concurrency: CONCURRENCY },
)

const grantAlertWorker = new Worker(
  'grant-alert-drain',
  async () => {
    // Both outboxes, one after the other, on one queue.
    //
    // They are separate tables with separate drains, but they share one mail
    // transport, and grants/mailer.ts paces sends with a module-level timestamp
    // to stay under Resend's 2 requests per second. A second queue draining the
    // notification outbox in parallel would step straight over that pacing, so
    // the two run in sequence inside this one serial worker instead.
    //
    // Sequential also means a broken grant drain cannot silently stop approval
    // emails: each call handles its own row failures and returns stats rather
    // than throwing.
    await processGrantAlertDrainJob()
    await processNotificationDrainJob()
  },
  // Concurrency MUST stay 1, for the pacing reason above.
  { connection, concurrency: 1 },
)

const grantDeadlineWorker = new Worker(
  'grant-deadline-sweep',
  async () => {
    await processGrantDeadlineSweepJob()
  },
  // Serial for the same reason as the drain: the sweep writes alert rows keyed
  // by a dedupe key, and one writer means no race on that key.
  { connection, concurrency: 1 },
)

// #endregion

// #region off-season events and practice fields

const listingDiscoverWorker = new Worker<ListingDiscoverPayload>(
  'listing-discover',
  async (job) => {
    console.log(`[listing-discover] processing job ${job.id} connector=${job.data.connector}`)
    const outcome = await processListingDiscoverJob(job.data)

    // Nothing is enqueued from here. Every connector in this vertical is
    // deterministic, so there is no classification step and no Anthropic
    // spend: the candidates sit pending until a human opens the admin.
    if (outcome.stats.limits.length > 0) {
      console.warn(
        `[listing-discover] ${outcome.connector} coverage limits: ${outcome.stats.limits.join('; ')}`,
      )
    }
    for (const err of outcome.stats.errors) {
      console.error(`[listing-discover] ${outcome.connector} error: ${err}`)
    }
    console.log(
      `[listing-discover] ${outcome.connector} filed ${outcome.insertedCandidateIds.length} ${outcome.vertical} candidates for review`,
    )

    // One summary per run, same rule as the other three queues.
    const filed = outcome.insertedCandidateIds.length
    if (filed > 0) {
      const queue =
        outcome.vertical === 'field'
          ? '/admin/practice-fields/candidates'
          : '/admin/event-listings/candidates'
      sendApprovalNotice({
        vertical: 'crawl',
        title: `${outcome.connector} found ${filed} ${outcome.vertical} lead${filed === 1 ? '' : 's'}`,
        reviewUrl: reviewQueueUrl(queue),
        description: `${filed} candidate${filed === 1 ? '' : 's'} waiting in the ${outcome.vertical} queue.`,
        facts: [
          { label: 'Connector', value: outcome.connector, inline: true },
          { label: 'New', value: filed, inline: true },
          { label: 'Coverage limits', value: outcome.stats.limits.join('; ') || null },
          { label: 'Errors', value: outcome.stats.errors.slice(0, 3).join('; ') || null },
        ],
      })
    }
  },
  // Serial. Both Chief Delphi connectors pace themselves inside the Discourse
  // client, and two of them running at once would double the request rate at
  // one volunteer-run forum, which is the pacing the client exists to hold.
  { connection, concurrency: 1 },
)

const seasonRenewalWorker = new Worker(
  'event-season-renewal',
  async () => {
    // Fires on a mid-April cron for a week of mornings. Every pass after the
    // first queues nothing, because the outbox dedupe key already holds each
    // ask. See listings/season-renewal.ts for why it is scheduled that way.
    await processSeasonRenewalJob()
  },
  // Serial. The sweep writes outbox rows keyed by a dedupe key, and one writer
  // means no race on that key.
  { connection, concurrency: 1 },
)

// #endregion

// Log worker errors without crashing
for (const worker of [crawlWorker, enrichWorker, freshnessWorker, linkCheckWorker, reindexWorker, submissionWorker, albumIngestWorker, albumEnrichWorker, grantDiscoverWorker, grantEnrichWorker, grantMonitorWorker, grantMatchWorker, grantAlertWorker, grantDeadlineWorker, listingDiscoverWorker, seasonRenewalWorker]) {
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
    albumIngestWorker.close(),
    albumEnrichWorker.close(),
    grantDiscoverWorker.close(),
    grantEnrichWorker.close(),
    grantMonitorWorker.close(),
    grantMatchWorker.close(),
    grantAlertWorker.close(),
    grantDeadlineWorker.close(),
    listingDiscoverWorker.close(),
    seasonRenewalWorker.close(),
  ])
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
