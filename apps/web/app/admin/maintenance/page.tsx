import { Suspense } from 'react'
import { Queue } from 'bullmq'
import { QueueStats } from './queue-stats'
import { QueuePoller } from './queue-poller'
import { DedupPanel } from './dedup-panel'
import { AdminJobTriggers } from '../crawls/job-triggers'

/** Check whether any queue currently has active jobs (for enabling the poller). */
async function hasActiveJobs(): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) return false
  const QUEUE_NAMES = ['crawl', 'enrich', 'freshness', 'reindex', 'link-check', 'submission']
  for (const name of QUEUE_NAMES) {
    const q = new Queue(name, { connection: { url: redisUrl } })
    try {
      const counts = await q.getJobCounts('active')
      if ((counts.active ?? 0) > 0) return true
    } finally {
      await q.close()
    }
  }
  return false
}

export default async function MaintenancePage() {
  const active = await hasActiveJobs()

  return (
    <div className="p-8 flex flex-col gap-6">
      <QueuePoller active={active} />

      <h1 className="text-2xl font-bold text-foreground">Maintenance</h1>

      {/* Queue status */}
      <Suspense fallback={<div className="text-sm text-muted">Loading queue stats…</div>}>
        <QueueStats />
      </Suspense>

      {/* Duplicate tools */}
      <DedupPanel />

      {/* Job triggers */}
      <AdminJobTriggers />
    </div>
  )
}
