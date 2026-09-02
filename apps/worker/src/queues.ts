import { Queue } from 'bullmq'
import { getRedis } from './redis.js'
import type { CrawlJobPayload, EnrichJobPayload, FreshnessCheckPayload, LinkCheckPayload, ReindexPayload, SubmissionJobPayload, AlbumIngestPayload, AlbumEnrichPayload } from '@the-tool-pit/types'
// The grants payload types live beside their processors rather than in
// @the-tool-pit/types, so the vertical could land without touching the shared
// package. Type-only imports, so nothing from the job modules is pulled into a
// process that only produces jobs.
import type { GrantDiscoverPayload } from './grants/discover.js'
import type { GrantEnrichPayload, GrantExtractPayload } from './grants/enrich.js'
import type { GrantMonitorPayload } from './grants/monitor.js'
import type { GrantMatchJobPayload } from './grants/matcher.js'
import type { ListingDiscoverPayload } from './listings/discover.js'
import type { ReadCandidatesPayload } from './listings/read-candidates.js'
import type { RosterRefreshPayload } from './listings/roster-refresh.js'
import type { PopularityRefreshPayload } from './jobs/popularity.js'
// The offseason season rule and the renewal date live beside the column they
// describe, so the schedule below and the migration that backfills the season
// cannot drift apart.
import {
  SEASON_RENEWAL_MONTH,
  SEASON_RENEWAL_DAY,
  SEASON_RENEWAL_WINDOW_DAYS,
} from '@the-tool-pit/db'

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

/**
 * The daily star and like refresh behind Popular.
 *
 * attempts: 1. The pass is a long serial sweep that stops itself on a rate
 * limit, so a BullMQ retry would start the same six hundred requests again
 * against a budget that is already spent. Every unit of work in it is
 * idempotent, so tomorrow's run picks up whatever this one missed.
 */
export const popularityQueue = new Queue<PopularityRefreshPayload>('popularity', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 30 },
    removeOnFail: { count: 60 },
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
 * The second pass over a candidate the classifier accepted: read the page and
 * fill in the record.
 *
 * Its own queue rather than more work inside grant-enrich, because the two
 * differ in what they cost and in when they run. Enrich is one cheap call per
 * crawled URL; extract is a bigger call per REAL grant, and a moderator
 * flagging a listing re-runs this one alone. Concurrency is held down in
 * index.ts for the same reason enrich's is.
 */
export const grantExtractQueue = new Queue<GrantExtractPayload>('grant-extract', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
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

// #region off-season events and practice fields

/**
 * Discovery sweeps for both listing verticals. One queue, because the job is
 * the same one either side: sweep, read deterministically, file a pending
 * candidate. The connector name in the payload decides which candidate table
 * the run writes to.
 *
 * Two attempts, the same reasoning as grant-discover: a connector run is a lot
 * of network for one job, and three attempts against a source that is simply
 * down triples the traffic we send it for nothing.
 */
export const listingDiscoverQueue = new Queue<ListingDiscoverPayload>('listing-discover', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
})

/**
 * Reading a discovered candidate properly: the thread, the event's own site,
 * and the pages behind its registration and pay links.
 *
 * Its own queue rather than part of listing-discover, because the two have
 * nothing in common operationally. Discovery is one request per source and
 * finishes in seconds. A read is a model call and up to eight page loads per
 * candidate, so it belongs somewhere it can take its time without holding a
 * sweep open, and somewhere a re-read does not force a re-crawl.
 *
 * Concurrency stays at 1 in index.ts: these open real browsers.
 */
export const readCandidatesQueue = new Queue<ReadCandidatesPayload>('read-candidates', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
})

/**
 * The registered team count on each off-season event, from TBA.
 *
 * The one number on these listings that moves week to week, and the only thing
 * about an event that the machine knows better than the organiser.
 */
export const rosterRefreshQueue = new Queue<RosterRefreshPayload>('roster-refresh', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
})

/**
 * The yearly "are you running it again" ask for last season's event listings.
 *
 * attempts: 1, the same reasoning as grant-alert-drain. The retry story lives
 * in the outbox rows the job writes, which carry their own attempt count and
 * dedupe key, so a BullMQ retry would only re-enter a sweep that is already
 * idempotent and buy nothing. If a pass dies halfway, tomorrow's pass in the
 * same window finishes the job.
 */
export const seasonRenewalQueue = new Queue('event-season-renewal', {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 20 },
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

  // Popularity refresh — daily, on a CRON PATTERN for the reason spelled out
  // above the grants block: `every` counts from the upsert, which is worker
  // startup, so a `every: 24h` sweep fires its full six hundred GitHub requests
  // on every single deploy.
  //
  // 07:20 is the first slot clear of everything else. The discovery sweeps run
  // 02:10 to 06:40 and the renewal ask is at 09:10, so this sits in the gap and
  // never shares a minute with another outbound-heavy job. Daily because stars
  // move daily and a directory that is a week behind on WPILib looks unmanned.
  await popularityQueue.upsertJobScheduler('popularity-refresh', { pattern: '20 7 * * *' }, {
    name: 'popularity-refresh',
    data: {},
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

  // --- Off-season events and practice fields ---
  // Cron patterns, not `every`, for the reason spelled out above the grants
  // block: `every` counts from the upsert, which is worker startup, so several
  // dailies fire together on each deploy. These three are pinned to their own
  // hours and slotted between the grant sweeps rather than on top of them.

  // TBA off-season events. One request per season, structured JSON, no model
  // call, and the tbaKey dedupe means a repeat run inserts nothing. Daily is
  // what makes an event that was registered yesterday reviewable today.
  await listingDiscoverQueue.upsertJobScheduler('listing-discover-tba-offseason', { pattern: '40 2 * * *' }, {
    name: 'listing-discover-tba-offseason',
    data: { connector: 'tba_offseason_events' },
  })

  // Chief Delphi off-season event threads. Twice a week, not daily: an
  // announcement thread sits on the forum for weeks, so daily searching buys
  // nothing and spends somebody else's bandwidth. Tuesday and Friday because
  // events get announced on a working week.
  await listingDiscoverQueue.upsertJobScheduler('listing-discover-cd-events', { pattern: '40 4 * * 2,5' }, {
    name: 'listing-discover-cd-events',
    data: { connector: 'cd_offseason_events' },
  })

  // Chief Delphi practice-field threads. Weekly, on a Sunday when the forum is
  // quiet, and deliberately an hour clear of the grants Chief Delphi sweep at
  // 05:10 so the two never queue requests at the same host at the same moment.
  await listingDiscoverQueue.upsertJobScheduler('listing-discover-cd-fields', { pattern: '40 6 * * 0' }, {
    name: 'listing-discover-cd-fields',
    data: { connector: 'cd_practice_fields' },
  })

  // Read whatever discovery has filed and nobody has read yet. Twice a day
  // rather than after each sweep: a candidate that failed its read at 02:40
  // because a site was down gets another go at 14:40 without anybody asking,
  // and a candidate added by hand from the admin is picked up the same way.
  await readCandidatesQueue.upsertJobScheduler('read-candidates-sweep', { pattern: '20 3,15 * * *' }, {
    name: 'read-candidates-sweep',
    data: {},
  })

  // Rosters, daily. A count that is a week old is worse than none during the
  // fortnight before an event, which is exactly when a team is deciding whether
  // there is still room. One request per listing with a TBA key, paced.
  await rosterRefreshQueue.upsertJobScheduler('roster-refresh-daily', { pattern: '50 5 * * *' }, {
    name: 'roster-refresh-daily',
    data: {},
  })

  // The mid-April renewal ask. A CRON PATTERN AND NOT `every`, and this is the
  // job the comment above the grants block was written for: `every` counts
  // from the upsert, which is worker startup, so `every: 365 days` would fire
  // the whole renewal run on the next deploy, whatever the date.
  //
  // Scheduled for a WEEK of mornings from the 15th, not one. A once-a-year job
  // pinned to a single day is one worker restart, one full disk or one bad
  // deploy away from skipping a whole season, and nobody would notice until
  // the following April. Passes two through seven are free: every ask is
  // already held by its dedupe key in notification_outbox, so they queue
  // nothing and log a line saying so.
  //
  // 09:10 UTC keeps it clear of the discovery sweeps, which all run between
  // 02:00 and 07:00.
  const renewalDays = `${SEASON_RENEWAL_DAY}-${SEASON_RENEWAL_DAY + SEASON_RENEWAL_WINDOW_DAYS - 1}`
  await seasonRenewalQueue.upsertJobScheduler(
    'event-season-renewal',
    { pattern: `10 9 ${renewalDays} ${SEASON_RENEWAL_MONTH} *` },
    { name: 'event-season-renewal', data: {} },
  )

  // Drain queued alerts every 5 minutes. Alerts are written by other jobs and
  // by the deadline sweep, and this is the only thing that turns them into
  // email, so the interval is the worst-case delay on a reminder. Cheap when
  // there is nothing pending: one indexed query that returns no rows.
  await grantAlertQueue.upsertJobScheduler('grant-alert-drain', { every: 5 * 60 * 1000 }, {
    name: 'grant-alert-drain',
    data: {},
  })
}
