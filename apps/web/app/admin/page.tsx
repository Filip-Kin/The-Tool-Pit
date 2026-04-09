import { getDb } from '@/lib/db'
import { tools, submissions, crawlJobs, toolVotes, searchEvents } from '@the-tool-pit/db'
import { eq, sql, desc, gte } from 'drizzle-orm'
import Link from 'next/link'
import { ClickableRow } from '@/components/admin/clickable-row'

async function getStats() {
  const db = getDb()
  const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString()

  const [
    [totalPublished],
    [totalDraft],
    [pendingSubmissions],
    [recentCrawls],
    [totalVotes],
    [searchesToday],
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(tools).where(eq(tools.status, 'published')),
    db.select({ count: sql<number>`count(*)::int` }).from(tools).where(eq(tools.status, 'draft')),
    db.select({ count: sql<number>`count(*)::int` }).from(submissions).where(eq(submissions.status, 'pending')),
    db.select({ count: sql<number>`count(*)::int` }).from(crawlJobs).where(gte(crawlJobs.createdAt, oneDayAgo)),
    db.select({ count: sql<number>`count(*)::int` }).from(toolVotes),
    db.select({ count: sql<number>`count(*)::int` }).from(searchEvents).where(gte(searchEvents.createdAt, oneDayAgo)),
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
    recentJobs,
  }
}

export default async function AdminOverviewPage() {
  const stats = await getStats()

  return (
    <div className="p-8 flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-foreground">Overview</h1>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Published Tools" value={stats.totalPublished} href="/admin/tools?status=published" />
        <StatCard label="Draft / Pending" value={stats.totalDraft} href="/admin/candidates?status=pending" />
        <StatCard label="Pending Submissions" value={stats.pendingSubmissions} href="/admin/submissions?status=pending" highlight={stats.pendingSubmissions > 0} />
        <StatCard label="Total Votes" value={stats.totalVotes} href="/admin/votes" />
        <StatCard label="Searches Today" value={stats.searchesToday} href="/admin/analytics" />
        <StatCard label="Crawls (24h)" value={stats.recentCrawls} href="/admin/crawls" />
      </div>

      {/* Recent crawl jobs */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">Recent Crawl Jobs</h2>
        {stats.recentJobs.length === 0 ? (
          <p className="text-sm text-muted">No crawl jobs yet.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
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
                      <StatusBadge status={job.status} />
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
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, highlight, href }: { label: string; value: number; highlight?: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={`rounded-lg border p-4 transition-colors hover:bg-surface-2 ${highlight ? 'border-(--color-official)/40 bg-(--color-official)/5' : 'border-border bg-surface'}`}
    >
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-3xl font-bold text-foreground">{value.toLocaleString()}</p>
    </Link>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    done: 'text-current',
    running: 'text-official',
    failed: 'text-frc',
    queued: 'text-muted',
  }
  return <span className={`text-xs font-medium ${colors[status] ?? 'text-muted'}`}>{status}</span>
}
