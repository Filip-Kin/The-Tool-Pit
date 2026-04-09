import { Queue } from 'bullmq'
import { getRedis } from '@/lib/redis'

const QUEUE_NAMES = ['crawl', 'enrich', 'freshness', 'reindex', 'link-check', 'submission'] as const

type JobCounts = {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

async function fetchQueueCounts(): Promise<{ name: string; counts: JobCounts }[]> {
  const results: { name: string; counts: JobCounts }[] = []

  for (const name of QUEUE_NAMES) {
    const q = new Queue(name, {
      connection: getRedis(),
    })
    try {
      const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
      results.push({ name, counts: counts as JobCounts })
    } finally {
      // Don't close the shared ioredis connection — just detach the queue wrapper
      await q.disconnect()
    }
  }

  return results
}

export async function QueueStats() {
  const queues = await fetchQueueCounts()
  const anyActive = queues.some((q) => q.counts.active > 0)

  return (
    <section className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-surface-2 border-b border-border-subtle">
        <h2 className="text-sm font-semibold text-foreground">Queue Status</h2>
        {anyActive && (
          <span className="flex items-center gap-1.5 text-xs text-official font-medium">
            <span className="h-2 w-2 rounded-full bg-official animate-pulse" />
            Active
          </span>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-muted text-xs">
          <tr>
            <th className="px-4 py-2 text-left">Queue</th>
            <th className="px-4 py-2 text-right">Waiting</th>
            <th className="px-4 py-2 text-right">Active</th>
            <th className="px-4 py-2 text-right">Delayed</th>
            <th className="px-4 py-2 text-right">Failed</th>
            <th className="px-4 py-2 text-right">Completed</th>
          </tr>
        </thead>
        <tbody>
          {queues.map(({ name, counts }) => (
            <tr key={name} className="border-t border-border-subtle">
              <td className="px-4 py-2 font-mono text-xs text-foreground">{name}</td>
              <td className="px-4 py-2 text-right text-xs text-muted">{counts.waiting || '—'}</td>
              <td className={`px-4 py-2 text-right text-xs font-medium ${counts.active > 0 ? 'text-official' : 'text-muted'}`}>
                {counts.active || '—'}
              </td>
              <td className="px-4 py-2 text-right text-xs text-muted">{counts.delayed || '—'}</td>
              <td className={`px-4 py-2 text-right text-xs font-medium ${counts.failed > 0 ? 'text-frc' : 'text-muted'}`}>
                {counts.failed || '—'}
              </td>
              <td className="px-4 py-2 text-right text-xs text-muted">{counts.completed || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
