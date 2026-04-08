import { getDb } from '@/lib/db'
import { crawlJobs } from '@the-tool-pit/db'
import { desc } from 'drizzle-orm'
import type { CrawlJobStats } from '@the-tool-pit/types'

async function getCrawlJobs() {
  const db = getDb()
  return db.select().from(crawlJobs).orderBy(desc(crawlJobs.createdAt)).limit(50)
}

export default async function CrawlJobsPage() {
  const jobs = await getCrawlJobs()

  return (
    <div className="p-8 flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-foreground">Crawl Jobs</h1>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted">No crawl jobs yet. They run automatically on schedule.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted text-xs">
              <tr>
                <th className="px-4 py-2 text-left">Connector</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Started</th>
                <th className="px-4 py-2 text-left">Finished</th>
                <th className="px-4 py-2 text-right">Discovered</th>
                <th className="px-4 py-2 text-right">New</th>
                <th className="px-4 py-2 text-left">Error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const stats = (job.stats ?? {}) as CrawlJobStats
                return (
                  <tr key={job.id} className="border-t border-border-subtle hover:bg-surface">
                    <td className="px-4 py-2 font-mono text-xs text-foreground">{job.connector}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">
                      {job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">
                      {job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-muted">{stats.discovered ?? '—'}</td>
                    <td className="px-4 py-2 text-right text-xs text-muted">{stats.new ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-muted max-w-xs truncate">
                      {job.error ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    done: 'text-foreground',
    running: 'text-official',
    failed: 'text-frc',
    queued: 'text-muted',
  }
  return <span className={`text-xs font-medium ${colors[status] ?? 'text-muted'}`}>{status}</span>
}
