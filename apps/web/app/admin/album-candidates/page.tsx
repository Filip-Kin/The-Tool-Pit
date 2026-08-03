import Link from 'next/link'
import { eq, desc, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albumCandidates, events } from '@the-tool-pit/db'
import type { AlbumCandidateMetadata, AlbumEventMatch } from '@the-tool-pit/db'
import { AlbumCandidateActions } from './candidate-actions'

const STATUS_TABS = ['pending', 'matched', 'suppressed', 'duplicate', 'published'] as const
type TabStatus = (typeof STATUS_TABS)[number]
const PAGE_SIZE = 30

export default async function AdminAlbumCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const params = await searchParams
  const status = (STATUS_TABS.includes(params.status as TabStatus) ? params.status : 'pending') as TabStatus
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const db = getDb()

  const [rows, [{ total }], counts] = await Promise.all([
    db
      .select({
        candidate: albumCandidates,
        eventName: events.name,
        eventCode: events.eventCode,
      })
      .from(albumCandidates)
      .leftJoin(events, eq(events.id, albumCandidates.matchedEventId))
      .where(eq(albumCandidates.status, status))
      .orderBy(desc(albumCandidates.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(albumCandidates).where(eq(albumCandidates.status, status)),
    db
      .select({ status: albumCandidates.status, count: sql<number>`count(*)::int` })
      .from(albumCandidates)
      .groupBy(albumCandidates.status),
  ])

  const countMap = Object.fromEntries(counts.map((r) => [r.status, r.count]))
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Album Candidates</h1>
        <p className="text-sm text-muted">{total.toLocaleString()} {status}</p>
      </div>

      <div className="flex gap-1 border-b border-border-subtle">
        {STATUS_TABS.map((s) => (
          <Link
            key={s}
            href={`/admin/album-candidates?status=${s}`}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm capitalize transition-colors ${
              status === s ? 'border-b-2 border-primary text-primary' : 'text-muted hover:text-foreground'
            }`}
          >
            {s}
            {countMap[s] != null && (
              <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">{countMap[s]}</span>
            )}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No {status} candidates.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-4 py-2 text-left">Album</th>
                <th className="px-4 py-2 text-left">Event</th>
                <th className="px-4 py-2 text-left w-28">Match</th>
                <th className="px-4 py-2 text-right w-56">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ candidate: row, eventName, eventCode }) => {
                const meta = (row.rawMetadata ?? {}) as AlbumCandidateMetadata
                const cls = (row.classification ?? {}) as Partial<AlbumEventMatch>
                const displayUrl = row.canonicalUrl ?? row.sourceUrl
                return (
                  <tr key={row.id} className="border-t border-border-subtle align-top hover:bg-surface">
                    <td className="max-w-xs px-4 py-3">
                      <span className="line-clamp-1 text-xs font-medium text-foreground">
                        {meta.title ?? displayUrl}
                      </span>
                      <a
                        href={displayUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 block line-clamp-1 break-all text-[10px] text-muted hover:underline"
                      >
                        {displayUrl}
                      </a>
                      <p className="mt-1 text-[10px] text-muted-2">
                        {row.provider} · {new Date(row.createdAt).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {eventName ? (
                        <span className="text-xs text-foreground">
                          {eventName} <span className="font-mono text-muted-2">({eventCode})</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-2">
                          {row.targetEventCode ? `target: ${row.targetEventCode}` : 'unmatched'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] text-muted-2">{cls.method ?? '-'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <AlbumCandidateActions
                        candidateId={row.id}
                        status={row.status}
                        hasEvent={Boolean(row.matchedEventId)}
                        targetEventCode={row.targetEventCode}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link
              href={`/admin/album-candidates?status=${status}&page=${page - 1}`}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              ← Prev
            </Link>
          )}
          <span className="px-3 py-1.5 text-xs text-muted">{page} / {totalPages}</span>
          {page < totalPages && (
            <Link
              href={`/admin/album-candidates?status=${status}&page=${page + 1}`}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
