import { getDb } from '@/lib/db'
import { crawlCandidates, crawlJobs } from '@the-tool-pit/db'
import { eq, desc, sql } from 'drizzle-orm'
import Link from 'next/link'
import { CandidateActions } from './candidate-actions'
import type { CandidateClassification, RawCandidateMetadata } from '@the-tool-pit/db'
import { ClickableRow } from '@/components/admin/clickable-row'

const STATUS_TABS = ['pending', 'suppressed', 'duplicate'] as const
type TabStatus = (typeof STATUS_TABS)[number]

const PAGE_SIZE = 30

export default async function AdminCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const params = await searchParams
  const status = (STATUS_TABS.includes(params.status as TabStatus) ? params.status : 'pending') as TabStatus
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const db = getDb()

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(crawlCandidates)
      .where(eq(crawlCandidates.status, status))
      .orderBy(desc(crawlCandidates.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),

    db
      .select({ total: sql<number>`count(*)::int` })
      .from(crawlCandidates)
      .where(eq(crawlCandidates.status, status)),
  ])

  // Count per status for tab badges
  const counts = await db
    .select({ status: crawlCandidates.status, count: sql<number>`count(*)::int` })
    .from(crawlCandidates)
    .groupBy(crawlCandidates.status)

  const countMap = Object.fromEntries(counts.map((r) => [r.status, r.count]))

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="p-8 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Candidates</h1>
        <p className="text-sm text-muted">
          {total.toLocaleString()} {status}
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-border-subtle">
        {STATUS_TABS.map((s) => (
          <Link
            key={s}
            href={`/admin/candidates?status=${s}`}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors capitalize ${
              status === s
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {s}
            {countMap[s] != null && (
              <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">
                {countMap[s]}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No {status} candidates.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted text-xs">
              <tr>
                <th className="px-4 py-2 text-left">URL</th>
                <th className="px-4 py-2 text-left">Classification</th>
                <th className="px-4 py-2 text-right w-24">Confidence</th>
                <th className="px-4 py-2 text-right w-36">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cls = (row.classification ?? {}) as CandidateClassification
                const meta = (row.rawMetadata ?? {}) as RawCandidateMetadata
                const displayUrl = row.canonicalUrl ?? row.sourceUrl
                const confidence = row.confidenceScore ?? cls.confidence ?? 0

                return (
                  <ClickableRow
                    key={row.id}
                    href={`/admin/candidates/${row.id}`}
                    className="border-t border-border-subtle hover:bg-surface align-top"
                  >
                    {/* URL + title */}
                    <td className="px-4 py-3 max-w-xs">
                      <Link
                        href={`/admin/candidates/${row.id}`}
                        className="text-xs text-primary hover:underline break-all line-clamp-1 font-medium"
                      >
                        {meta.title ?? displayUrl}
                      </Link>
                      <a
                        href={displayUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 text-[10px] text-muted hover:underline break-all line-clamp-1 block"
                      >
                        {displayUrl}
                      </a>
                      {cls.summary && (
                        <p className="mt-1 text-xs text-muted line-clamp-2">{cls.summary}</p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-2">
                        {new Date(row.createdAt).toLocaleDateString()}
                      </p>
                    </td>

                    {/* Classification tags */}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {cls.toolType && (
                          <Tag>{cls.toolType.replace(/_/g, ' ')}</Tag>
                        )}
                        {(cls.programs ?? []).map((p) => (
                          <Tag key={p} color="program">{p.toUpperCase()}</Tag>
                        ))}
                        {cls.isOfficial && <Tag color="official">official</Tag>}
                        {cls.isVendor && <Tag color="vendor">vendor</Tag>}
                        {cls.isRookieFriendly && <Tag color="rookie">rookie</Tag>}
                      </div>
                      {cls.reasoning && (
                        <p className="mt-1.5 text-[10px] text-muted-2 line-clamp-2 italic">
                          {cls.reasoning}
                        </p>
                      )}
                    </td>

                    {/* Confidence */}
                    <td className="px-4 py-3 text-right">
                      <ConfidenceBar value={confidence} />
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <CandidateActions candidateId={row.id} status={row.status} />
                    </td>
                  </ClickableRow>
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
              href={`/admin/candidates?status=${status}&page=${page - 1}`}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
            >
              ← Prev
            </Link>
          )}
          <span className="px-3 py-1.5 text-xs text-muted">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/admin/candidates?status=${status}&page=${page + 1}`}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

function Tag({
  children,
  color,
}: {
  children: React.ReactNode
  color?: 'program' | 'official' | 'vendor' | 'rookie'
}) {
  const base = 'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border'
  const variants = {
    program: 'bg-primary/10 text-primary border-primary/20',
    official: 'bg-official/10 text-official border-official/20',
    vendor: 'bg-vendor/10 text-vendor border-vendor/20',
    rookie: 'bg-rookie/10 text-rookie border-rookie/20',
    default: 'bg-surface-3 text-muted border-border',
  }
  return (
    <span className={`${base} ${variants[color ?? 'default']}`}>{children}</span>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs font-mono text-foreground">{pct}%</span>
      <div className="h-1 w-16 rounded-full bg-surface-3">
        <div className={`h-1 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
