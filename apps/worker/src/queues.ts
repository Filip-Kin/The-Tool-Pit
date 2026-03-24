import { Queue } from 'bullmq'
import { getRedis } from './redis.js'
import type { CrawlJobPayload, EnrichJobPayload, FreshnessCheckPayload, ReindexPayload } from '@the-tool-pit/types'

// One Redis connection for all queues
const connection = getRedis()

export const crawlQueue = new Queue<CrawlJobPayload>('crawl', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
})

export const enrichQueue = new Queue<EnrichJobPayload>('enrich', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
})

export const freshnessQueue = new Queue<FreshnessCheckPayload>('freshness', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 10000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
})

export const reindexQueue = new Queue<ReindexPayload>('reindex', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { count: 50 },
  },
})

/** Schedule recurring jobs. Call once on worker startup. */
export async function scheduleRecurringJobs() {
  // Re-crawl fta.tools every 6 hours
  await crawlQueue.upsertJobScheduler('crawl-fta-tools', { every: 6 * 60 * 60 * 1000 }, {
    name: 'crawl-fta-tools',
    data: { connector: 'fta_tools', jobId: 'scheduled' },
  })

  // Re-crawl volunteer.systems every 12 hours
  await crawlQueue.upsertJobScheduler('crawl-volunteer-systems', { every: 12 * 60 * 60 * 1000 }, {
    name: 'crawl-volunteer-systems',
    data: { connector: 'volunteer_systems', jobId: 'scheduled' },
  })

  // Freshness pass every 24 hours — check all published tools
  // (individual tool freshness jobs are spawned by this scheduler job)
  await freshnessQueue.upsertJobScheduler('freshness-pass', { every: 24 * 60 * 60 * 1000 }, {
    name: 'freshness-pass-trigger',
    data: { toolId: '__all__' },
  })
}
