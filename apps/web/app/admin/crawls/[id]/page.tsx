import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getDb } from '@/lib/db'
import { crawlJobs, crawlCandidates } from '@the-tool-pit/db'
import { eq, desc } from 'drizzle-orm'
import type { CrawlJobStats } from '@the-tool-pit/types'
import type { CandidateClassification, RawCandidateMetadata } from '@the-tool-pit/db'

export default async function CrawlJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const db = getDb()

  const [job] = await db.select().from(crawlJobs).where(eq(crawlJobs.id, id)).limit(1)
  if (!job) notFound()

  const candidates = await db
    .select()
    .from(crawlCandidates)
    .where(eq(crawlCandidates.jobId, id))
    .orderBy(desc(crawlCandidates.createdAt))
    .limit(200)

  const stats = (job.stats ?? {}) as CrawlJobStats

  return (
    <div className="p-8 max-w-4xl flex flex-col gap-8">
      {/* Header */}
      <div>
        <Link href="/admin/crawls" className="text-xs text-muted hover:text-foreground">
          ← Crawl Jobs
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground font-mono">{job.connector}</h1>
          <StatusBadge status={job.status} />
        </div>
        <p className="mt-1 text-xs text-muted-2 font-mono">{job.id}</p>
      </div>

      {/* Job details */}
      <section className="rounded-lg border border-border p-5 flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-foreground">Details</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted mb-0.5">Started</dt>
            <dd className="text-foreground">{job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted mb-0.5">Finished</dt>
            <dd className="text-foreground">{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted mb-0.5">Duration</dt>
            <dd className="text-foreground">
              {job.startedAt && job.finishedAt
                ? formatDuration(new Date(job.startedAt), new Date(job.finishedAt))
                : '—'}
            </dd>
          </div>
        </dl>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatPill label="Discovered" value={stats.discovered} />
          <StatPill label="New" value={stats.new} color="green" />
          <StatPill label="Updated" value={stats.updated} color="blue" />
          <StatPill label="Skipped" value={stats.skipped} />
          <StatPill label="Failed" value={stats.failed} color="red" />
        </div>

        {job.error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-4 py-3">
            <p className="text-xs font-medium text-red-400 mb-1">Error</p>
            <p className="text-xs text-red-300 font-mono break-all">{job.error}</p>
          </div>
        )}
      </section>

      {/* Discovered candidates */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Discovered Candidates</h2>
          <span className="text-xs text-muted">{candidates.length} shown</span>
        </div>

        {candidates.length === 0 ? (
          <p className="text-sm text-muted">No candidates recorded for this job.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-muted text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">Title / URL</th>
                  <th className="px-4 py-2 text-left">Classification</th>
                  <th className="px-4 py-2 text-center w-24">Status</th>
                  <th className="px-4 py-2 text-right w-20">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const cls = (c.classification ?? {}) as CandidateClassification
                  const meta = (c.rawMetadata ?? {}) as RawCandidateMetadata
                  const displayUrl = c.canonicalUrl ?? c.sourceUrl
                  const confidence = c.confidenceScore ?? cls.confidence ?? 0
                  const pct = Math.round(confidence * 100)

                  return (
                    <tr key={c.id} className="border-t border-border-subtle hover:bg-surface">
                      <td className="px-4 py-2 max-w-xs">
                        <Link
                          href={`/admin/candidates/${c.id}`}
                          className="text-xs text-primary hover:underline font-medium line-clamp-1"
                        >
                          {meta.title ?? displayUrl}
                        </Link>
                        <span className="block text-[10px] text-muted truncate">{displayUrl}</span>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {cls.toolType && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border bg-surface-3 text-muted border-border">
                              {cls.toolType.replace(/_/g, ' ')}
                            </span>
                          )}
                          {(cls.programs ?? []).map((p) => (
                            <span key={p} className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border bg-primary/10 text-primary border-primary/20">
                              {p.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <CandidateStatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-2 text-right text-xs font-mono text-foreground">
                        {pct}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    done: 'bg-green-500/10 text-green-400 border-green-500/30',
    running: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    failed: 'bg-red-500/10 text-red-400 border-red-500/30',
    queued: 'bg-surface-3 text-muted border-border',
  }
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium border ${variants[status] ?? 'bg-surface-3 text-muted border-border'}`}>
      {status}
    </span>
  )
}

function CandidateStatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    pending: 'text-amber-400',
    published: 'text-green-400',
    suppressed: 'text-red-400',
    duplicate: 'text-muted',
    matched: 'text-blue-400',
    merged: 'text-blue-400',
  }
  return (
    <span className={`text-xs capitalize ${variants[status] ?? 'text-muted'}`}>{status}</span>
  )
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string
  value?: number
  color?: 'green' | 'blue' | 'red'
}) {
  const colorMap = {
    green: 'text-green-400',
    blue: 'text-blue-400',
    red: 'text-red-400',
  }
  return (
    <div className="rounded-md border border-border bg-surface p-3 flex flex-col gap-1">
      <p className="text-[10px] text-muted">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${color ? colorMap[color] : 'text-foreground'}`}>
        {value ?? 0}
      </p>
    </div>
  )
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}
