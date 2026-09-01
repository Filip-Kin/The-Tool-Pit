import { Queue } from 'bullmq'
import { getRedis } from './redis.js'
import type { CrawlJobPayload, EnrichJobPayload, FreshnessCheckPayload, LinkCheckPayload, ReindexPayload, SubmissionJobPayload, AlbumIngestPayload, AlbumEnrichPayload } from '@the-tool-pit/types'
// The grants payload types live beside their processors rather than in
// @the-tool-pit/types, so the vertical could land without touching the shared
// package. Type-only imports, so nothing from the job modules is pulled into a
// process that only produces jobs.
import type { GrantDiscoverPayload } from './grants/discover.js'
import type { GrantEnrichPayload } from './grants/enrich.js'
import type { GrantMonitorPayload } from './grants/monitor.js'
import type { GrantMatchJobPayload } from './grants/matcher.js'

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

export const linkCheckQueue = new Queue<LinkCheckPayload>('link-check', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
})

export const submissionQueue = new Queue<SubmissionJobPayload>('submission', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
})

// Photo album aggregator queues
export const albumIngestQueue = new Queue<AlbumIngestPayload>('album-ingest', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
})

export const albumEnrichQueue = new Queue<AlbumEnrichPayload>('album-enrich', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
})

// #region grants

/**
 * Discovery sweeps. One job per connector, dispatched through
 * GRANT_DISCOVER_CONNECTORS. Retries are worth having here because a connector
 * run is a lot of network for one job, but three attempts on a source that is
 * simply down just triples the traffic, so two.
 */
export const grantDiscoverQueue = new Queue<GrantDiscoverPayload>('grant-discover', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
})

/** One Haiku call per job, so the same shape as the tools enrich queue. */
export const grantEnrichQueue = new Queue<GrantEnrichPayload>('grant-enrich', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
})

/**
 * Re-check one published grant's page for changes.
 *
 * Only two attempts on purpose: processGrantMonitorJob returns rather than
 * throws for a 404, a timeout or a PDF, so anything that does reach the retry
 * path is refetching the same broken page.
 */
export const grantMonitorQueue = new Queue<GrantMonitorPayload>('grant-monitor', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 30000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
})

/** Score one team profile against the published catalogue. Pure database work. */
export const grantMatchQueue = new Queue<GrantMatchJobPayload>('grant-match', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 10000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
})

/**
 * Drains pending grant_alerts rows out as email.
 *
 * attempts: 1 is deliberate. Retry state lives on the alert rows themselves,
 * which carry their own attempt count and dedupe key, so a BullMQ retry would
 * only re-enter a drain that is already idempotent and risk double sends.
 */
export const grantAlertQueue = new Queue('grant-alert-drain', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
})

/** Turns upcoming deadlines on watched grants into queued alerts. Idempotent. */
export const grantDeadlineQueue = new Queue('grant-deadline-sweep', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { count: 50 },
  },
})

// #endregion

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

  // GitHub topics crawl — once per day (respects API rate limits)
  await crawlQueue.upsertJobScheduler('crawl-github-topics', { every: 24 * 60 * 60 * 1000 }, {
    name: 'crawl-github-topics',
    data: { connector: 'github_topics', jobId: 'scheduled' },
  })

  // Awesome-list crawl — once per day
  await crawlQueue.upsertJobScheduler('crawl-awesome-list', { every: 24 * 60 * 60 * 1000 }, {
    name: 'crawl-awesome-list',
    data: { connector: 'awesome_list', jobId: 'scheduled' },
  })

  // Spectrum FRC CAD Collection — curated team CAD, changes slowly, so once per week
  await crawlQueue.upsertJobScheduler('crawl-spectrum-cad', { every: 7 * 24 * 60 * 60 * 1000 }, {
    name: 'crawl-spectrum-cad',
    data: { connector: 'spectrum_cad', jobId: 'scheduled' },
  })

  // Freshness pass every 24 hours — check all published tools
  // (individual tool freshness jobs are spawned by this scheduler job)
  await freshnessQueue.upsertJobScheduler('freshness-pass', { every: 24 * 60 * 60 * 1000 }, {
    name: 'freshness-pass-trigger',
    data: { toolId: '__all__' },
  })

  // Dead-link check pass — once per week
  await linkCheckQueue.upsertJobScheduler('link-check-pass', { every: 7 * 24 * 60 * 60 * 1000 }, {
    name: 'link-check-pass-trigger',
    data: { toolId: '__all__' },
  })

  // --- Photo album aggregator ---
  const currentSeasonYear = new Date().getFullYear()

  // Sync FRC events + team rosters from TBA — once per day
  await albumIngestQueue.upsertJobScheduler('album-sync-tba', { every: 24 * 60 * 60 * 1000 }, {
    name: 'album-sync-tba',
    data: { connector: 'tba_events', year: currentSeasonYear, jobId: 'scheduled' },
  })

  // Sync FTC events + team rosters from self-hosted TOA — once per day
  await albumIngestQueue.upsertJobScheduler('album-sync-toa', { every: 24 * 60 * 60 * 1000 }, {
    name: 'album-sync-toa',
    data: { connector: 'toa_events', year: currentSeasonYear, jobId: 'scheduled' },
  })

  // Scrape First in Michigan event photo links — every 12 hours
  await albumIngestQueue.upsertJobScheduler('album-crawl-fim', { every: 12 * 60 * 60 * 1000 }, {
    name: 'album-crawl-fim',
    data: { connector: 'fim_albums', year: currentSeasonYear, jobId: 'scheduled' },
  })

  // Search Chief Delphi for album links - once per day
  await albumIngestQueue.upsertJobScheduler('album-crawl-cd', { every: 24 * 60 * 60 * 1000 }, {
    name: 'album-crawl-cd',
    data: { connector: 'chief_delphi_albums', year: currentSeasonYear, jobId: 'scheduled' },
  })

  // Scrape curated Flickr photographer accounts - once per day
  await albumIngestQueue.upsertJobScheduler('album-crawl-flickr', { every: 24 * 60 * 60 * 1000 }, {
    name: 'album-crawl-flickr',
    data: { connector: 'flickr_albums', year: currentSeasonYear, jobId: 'scheduled' },
  })

  // Walk curated SmugMug photographer sites - once per day
  await albumIngestQueue.upsertJobScheduler('album-crawl-smugmug', { every: 24 * 60 * 60 * 1000 }, {
    name: 'album-crawl-smugmug',
    data: { connector: 'smugmug_albums', year: currentSeasonYear, jobId: 'scheduled' },
  })

  // --- Grants ---
  // The discovery sweeps use cron patterns rather than `every` because `every`
  // counts from whenever the scheduler was upserted, which is worker startup,
  // so four `every: 24h` sweeps would all fire together on every deploy. A
  // pattern pins each one to its own hour and keeps the outbound traffic, the
  // Brave budget and the Anthropic spend spread across the night.

  // Curated funder list. Small, cheap, and the source of truth for the rest, so
  // it runs first.
  await grantDiscoverQueue.upsertJobScheduler('grant-discover-seed', { pattern: '10 2 * * *' }, {
    name: 'grant-discover-seed',
    data: { connector: 'grant_seed' },
  })

  // Brave web search. Bounded twice over, by its own per-run query cap and by
  // the hard monthly Brave budget in Redis, so daily is safe.
  await grantDiscoverQueue.upsertJobScheduler('grant-discover-web-search', { pattern: '10 3 * * *' }, {
    name: 'grant-discover-web-search',
    data: { connector: 'grant_web_search' },
  })

  // Sponsor logos and thank-you pages off team sites, a rotating slice of teams
  // per run. Daily is what makes the rotation cover the roster in a season.
  await grantDiscoverQueue.upsertJobScheduler('grant-discover-team-sponsors', { pattern: '10 4 * * *' }, {
    name: 'grant-discover-team-sponsors',
    data: { connector: 'grant_team_sponsors' },
  })

  // Chief Delphi threads about funding. A forum moves slowly and this is
  // someone else's server, so weekly, on a Sunday when the site is quiet.
  await grantDiscoverQueue.upsertJobScheduler('grant-discover-chief-delphi', { pattern: '10 5 * * 0' }, {
    name: 'grant-discover-chief-delphi',
    data: { connector: 'grant_chief_delphi' },
  })

  // Monitor due-check every hour. The hourly tick is only a trigger: each grant
  // carries its own checkCadenceHours, from daily inside a deadline window down
  // to monthly when nothing is close, and enqueueDueGrantMonitors returns only
  // the ones actually due. Checking hourly costs one query and is what lets a
  // grant that just crossed into its final 30 days get picked up that day
  // rather than up to six hours later.
  await grantMonitorQueue.upsertJobScheduler('grant-monitor-due', { every: 60 * 60 * 1000 }, {
    name: 'grant-monitor-due',
    data: { grantId: '__all__' },
  })

  // Re-match every team profile once a day. A profile is re-matched when it is
  // saved, but a grant published or a cycle confirmed by an admin changes the
  // answer for profiles nobody touched, and there is no fan-out on publish yet,
  // so this sweep is what closes that gap.
  await grantMatchQueue.upsertJobScheduler('grant-match-sweep', { every: 24 * 60 * 60 * 1000 }, {
    name: 'grant-match-sweep',
    data: { profileId: '__all__' },
  })

  // Deadline reminders once a day. The offsets people pick are whole days
  // (30, 14, 3 before), so a finer tick would find nothing new, and the sweep
  // is idempotent on its dedupe key if it does run more often.
  await grantDeadlineQueue.upsertJobScheduler('grant-deadline-sweep', { every: 24 * 60 * 60 * 1000 }, {
    name: 'grant-deadline-sweep',
    data: {},
  })

  // Drain queued alerts every 5 minutes. Alerts are written by other jobs and
  // by the deadline sweep, and this is the only thing that turns them into
  // email, so the interval is the worst-case delay on a reminder. Cheap when
  // there is nothing pending: one indexed query that returns no rows.
  await grantAlertQueue.upsertJobScheduler('grant-alert-drain', { every: 5 * 60 * 1000 }, {
    name: 'grant-alert-drain',
    data: {},
  })
}
