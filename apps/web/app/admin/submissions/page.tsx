import { getDb } from '@/lib/db'
import { submissions, tools } from '@the-tool-pit/db'
import { eq, desc, sql, inArray } from 'drizzle-orm'
import Link from 'next/link'
import { SubmissionActions } from './submission-actions'
import type { PipelineLogEntry } from '@the-tool-pit/db'

const STATUS_TABS = ['pending', 'processing', 'needs_review', 'published', 'duplicate', 'rejected'] as const
type TabStatus = (typeof STATUS_TABS)[number]

const TAB_LABELS: Record<TabStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  needs_review: 'Needs Review',
  published: 'Published',
  duplicate: 'Duplicate',
  rejected: 'Rejected',
}

const PAGE_SIZE = 40

export default async function AdminSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const params = await searchParams
  const status = (STATUS_TABS.includes(params.status as TabStatus)
    ? params.status
    : 'pending') as TabStatus
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const db = getDb()

  const [rows, [{ total }], counts] = await Promise.all([
    db
      .select()
      .from(submissions)
      .where(eq(submissions.status, status))
      .orderBy(desc(submissions.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),

    db
      .select({ total: sql<number>`count(*)::int` })
      .from(submissions)
      .where(eq(submissions.status, status)),

    db
      .select({ status: submissions.status, count: sql<number>`count(*)::int` })
      .from(submissions)
      .groupBy(submissions.status),
  ])

  const countMap = Object.fromEntries(counts.map((r) => [r.status, r.count]))

  // Load resolved tool names for published submissions
  const resolvedIds = rows.map((r) => r.resolvedToolId).filter(Boolean) as string[]
  const resolvedTools =
    resolvedIds.length > 0
      ? await db
          .select({ id: tools.id, name: tools.name, slug: tools.slug })
          .from(tools)
          .where(inArray(tools.id, resolvedIds))
      : []
  const resolvedMap = new Map(resolvedTools.map((t) => [t.id, t]))

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const ALERT_STATUSES: TabStatus[] = ['pending', 'needs_review']

  return (
    <div className="p-8 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Submissions</h1>
        <p className="text-sm text-[var(--color-muted)]">
          {total.toLocaleString()} {TAB_LABELS[status].toLowerCase()}
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border-subtle)]">
        {STATUS_TABS.map((s) => {
          const count = countMap[s] ?? 0
          const isAlert = ALERT_STATUSES.includes(s) && count > 0
          return (
            <Link
              key={s}
              href={`/admin/submissions?status=${s}`}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                status === s
                  ? 'border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
              }`}
            >
              {TAB_LABELS[s]}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    isAlert
                      ? 'bg-[var(--color-official)]/20 text-[var(--color-official)]'
                      : 'bg-[var(--color-surface-3)] text-[var(--color-muted)]'
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">No {TAB_LABELS[status].toLowerCase()} submissions.</p>
      ) : (
        <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-2)] text-[var(--color-muted)] text-xs">
              <tr>
                <th className="px-4 py-2 text-left">URL</th>
                <th className="px-4 py-2 text-left">Note</th>
                <th className="px-4 py-2 text-left">Pipeline</th>
                <th className="px-4 py-2 text-left w-32">Submitted</th>
                <th className="px-4 py-2 text-right w-40">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const log = (row.pipelineLog ?? []) as PipelineLogEntry[]
                const lastLog = log[log.length - 1]
                const resolvedTool = row.resolvedToolId ? resolvedMap.get(row.resolvedToolId) : null

                return (
                  <tr
                    key={row.id}
                    className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface)] align-top"
                  >
                    {/* URL */}
                    <td className="px-4 py-3 max-w-xs">
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[var(--color-primary)] hover:underline break-all line-clamp-2"
                      >
                        {row.url}
                      </a>
                      {resolvedTool && (
                        <Link
                          href={`/admin/tools/${resolvedTool.id}`}
                          className="mt-1 block text-[10px] text-green-400 hover:underline"
                        >
                          → {resolvedTool.name}
                        </Link>
                      )}
                    </td>

                    {/* Submitter note */}
                    <td className="px-4 py-3 max-w-[180px]">
                      {row.submitterNote ? (
                        <p className="text-xs text-[var(--color-muted)] line-clamp-3">{row.submitterNote}</p>
                      ) : (
                        <span className="text-xs text-[var(--color-muted-2)]">—</span>
                      )}
                    </td>

                    {/* Pipeline log — show last entry */}
                    <td className="px-4 py-3">
                      {lastLog ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <LogDot logStatus={lastLog.status} />
                            <span className="text-xs text-[var(--color-muted)] font-mono">{lastLog.stage}</span>
                          </div>
                          {lastLog.message && (
                            <p className="mt-0.5 text-[10px] text-[var(--color-muted-2)] line-clamp-2">
                              {lastLog.message}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--color-muted-2)]">—</span>
                      )}
                    </td>

                    {/* Submitted at */}
                    <td className="px-4 py-3 text-xs text-[var(--color-muted)] whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleDateString()}
                      <br />
                      <span className="text-[var(--color-muted-2)]">
                        {new Date(row.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <SubmissionActions submissionId={row.id} status={row.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex gap-2 justify-center">
          {page > 1 && (
            <Link
              href={`/admin/submissions?status=${status}&page=${page - 1}`}
              className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
            >
              ← Prev
            </Link>
          )}
          <span className="px-3 py-1.5 text-xs text-[var(--color-muted)]">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/admin/submissions?status=${status}&page=${page + 1}`}
              className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

function LogDot({ logStatus }: { logStatus: 'ok' | 'warn' | 'error' | 'skip' }) {
  const colors = {
    ok: 'bg-green-500',
    warn: 'bg-yellow-500',
    error: 'bg-red-500',
    skip: 'bg-[var(--color-muted-2)]',
  }
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${colors[logStatus]}`} />
}
