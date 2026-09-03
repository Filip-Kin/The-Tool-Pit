import { getDb } from '@/lib/db'
import {
  tools,
  submissions,
  crawlJobs,
  toolVotes,
  searchEvents,
  eventListingCandidates,
  practiceFieldCandidates,
} from '@the-tool-pit/db'
import { eq, sql, desc, gte } from 'drizzle-orm'
import Link from 'next/link'
import { ClickableRow } from '@/components/admin/clickable-row'
import { StatusText } from '@/components/admin/status'
import { assertAdmin } from '@/lib/admin/auth'
import { getAdminQueueBacklog, getWorkerQueueBacklog } from '@/lib/admin/queue-counts'

async function getStats() {
  const db = getDb()
  const oneDayAgo = new Date(Date.now() - 86_400_000)

  const [
    [totalPublished],
    [totalDraft],
    [pendingSubmissions],
    [recentCrawls],
    [totalVotes],
    [searchesToday],
    [pendingEventCandidates],
    [pendingFieldCandidates],
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(tools).where(eq(tools.status, 'published')),
    db.select({ count: sql<number>`count(*)::int` }).from(tools).where(eq(tools.status, 'draft')),
    db.select({ count: sql<number>`count(*)::int` }).from(submissions).where(eq(submissions.status, 'pending')),
    db.select({ count: sql<number>`count(*)::int` }).from(crawlJobs).where(gte(crawlJobs.createdAt, oneDayAgo)),
    db.select({ count: sql<number>`count(*)::int` }).from(toolVotes),
    db.select({ count: sql<number>`count(*)::int` }).from(searchEvents).where(gte(searchEvents.createdAt, oneDayAgo)),
    // The two newest discovery queues. They file overnight and nothing else on
    // this page would show that they had, so an unattended pile stays visible.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(eventListingCandidates)
      .where(eq(eventListingCandidates.status, 'pending')),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(practiceFieldCandidates)
      .where(eq(practiceFieldCandidates.status, 'pending')),
  ])

  const recentJobs = await db
    .select()
    .from(crawlJobs)
    .orderBy(desc(crawlJobs.createdAt))
    .limit(5)

  return {
    totalPublished: totalPublished.count,
    totalDraft: totalDraft.count,
    pendingSubmissions: pendingSubmissions.count,
    recentCrawls: recentCrawls.count,
    totalVotes: totalVotes.count,
    searchesToday: searchesToday.count,
    pendingEventCandidates: pendingEventCandidates.count,
    pendingFieldCandidates: pendingFieldCandidates.count,
    recentJobs,
  }
}

export default async function AdminOverviewPage() {
  await assertAdmin()
  const [stats, backlog, workerQueues] = await Promise.all([
    getStats(),
    getAdminQueueBacklog(),
    getWorkerQueueBacklog(),
  ])

  return (
    <div className="p-4 md:p-8 flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-foreground">Overview</h1>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Published Tools" value={stats.totalPublished} href="/admin/tools?status=published" />
        <StatCard label="Draft / Pending" value={stats.totalDraft} href="/admin/candidates?status=pending" />
        <StatCard label="Pending Submissions" value={stats.pendingSubmissions} href="/admin/submissions?status=pending" highlight={stats.pendingSubmissions > 0} />
        <StatCard label="Total Votes" value={stats.totalVotes} href="/admin/votes" />
        <StatCard label="Searches Today" value={stats.searchesToday} href="/admin/analytics" />
        <StatCard label="Crawls (24h)" value={stats.recentCrawls} href="/admin/crawls" />
        <StatCard
          label="Event candidates"
          value={stats.pendingEventCandidates}
          href="/admin/event-listings/candidates"
          highlight={stats.pendingEventCandidates > 0}
        />
        <StatCard
          label="Field candidates"
          value={stats.pendingFieldCandidates}
          href="/admin/practice-fields/candidates"
          highlight={stats.pendingFieldCandidates > 0}
        />
      </div>

      {/* Queue backlog: one row per review queue, so albums and grants, the two
          largest and the ones the tiles above omit, are visible with how long
          the oldest item has waited. */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">Queue backlog</h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[28rem] w-full text-sm">
              <thead className="bg-surface-2 text-muted text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">Queue</th>
                  <th className="px-4 py-2 text-right">Pending</th>
                  <th className="px-4 py-2 text-right">Oldest waiting</th>
                </tr>
              </thead>
              <tbody>
                {backlog.map((row) => (
                  <ClickableRow
                    key={row.key}
                    href={row.href}
                    className={`border-t border-border-subtle hover:bg-surface ${row.count > 0 ? '' : 'text-muted'}`}
                  >
                    <td className="px-4 py-2 text-foreground">{row.label}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {row.count > 0 ? (
                        <span className="font-semibold text-foreground">{row.count.toLocaleString()}</span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-muted">
                      {row.oldestPendingAt ? new Date(row.oldestPendingAt).toLocaleDateString() : '—'}
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Worker queues: reading jobs and team-list crawls run entirely through
          BullMQ and never write the *_crawl_jobs tables the backlog above reads,
          so their state lives in Redis. One row per queue, waiting/active plus
          the actionable failed count and how long the oldest job has waited. */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">Worker queues</h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[36rem] w-full text-sm">
              <thead className="bg-surface-2 text-muted text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">Queue</th>
                  <th className="px-4 py-2 text-right">Waiting</th>
                  <th className="px-4 py-2 text-right">Active</th>
                  <th className="px-4 py-2 text-right">Failed</th>
                  <th className="px-4 py-2 text-right">Oldest waiting</th>
                </tr>
              </thead>
              <tbody>
                {workerQueues.map((row) => (
                  <ClickableRow
                    key={row.key}
                    href={row.href}
                    className={`border-t border-border-subtle hover:bg-surface ${row.waiting + row.active + row.failed > 0 ? '' : 'text-muted'}`}
                  >
                    <td className="px-4 py-2 text-foreground">{row.label}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-muted">
                      {row.waiting > 0 ? row.waiting.toLocaleString() : '—'}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${row.active > 0 ? 'text-official font-medium' : 'text-muted'}`}>
                      {row.active > 0 ? row.active.toLocaleString() : '—'}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono text-xs ${row.failed > 0 ? 'text-frc font-semibold' : 'text-muted'}`}>
                      {row.failed > 0 ? row.failed.toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-muted">
                      {row.oldestWaitingAt ? new Date(row.oldestWaitingAt).toLocaleString() : '—'}
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent crawl jobs */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">Recent Crawl Jobs</h2>
        {stats.recentJobs.length === 0 ? (
          <p className="text-sm text-muted">No crawl jobs yet.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-[36rem] w-full text-sm">
                            <thead className="bg-surface-2 text-muted text-xs">
                              <tr>
                                <th className="px-4 py-2 text-left">Connector</th>
                                <th className="px-4 py-2 text-left">Status</th>
                                <th className="px-4 py-2 text-left">Started</th>
                                <th className="px-4 py-2 text-right">Stats</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stats.recentJobs.map((job) => (
                                <ClickableRow key={job.id} href={`/admin/crawls/${job.id}`} className="border-t border-border-subtle hover:bg-surface">
                                  <td className="px-4 py-2 font-mono text-xs text-foreground">{job.connector}</td>
                                  <td className="px-4 py-2">
                                    <StatusText status={job.status} />
                                  </td>
                                  <td className="px-4 py-2 text-xs text-muted">
                                    {job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}
                                  </td>
                                  <td className="px-4 py-2 text-right text-xs text-muted">
                                    {job.stats ? `${(job.stats as any).discovered ?? 0} found` : '—'}
                                  </td>
                                </ClickableRow>
                              ))}
                            </tbody>
                          </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, highlight, href }: { label: string; value: number; highlight?: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={`rounded-lg border p-4 transition-colors hover:bg-surface-2 ${highlight ? 'border-official/40 bg-official/5' : 'border-border bg-surface'}`}
    >
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold text-foreground">{value.toLocaleString()}</p>
    </Link>
  )
}
