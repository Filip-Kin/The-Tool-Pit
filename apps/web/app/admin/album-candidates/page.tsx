import Link from 'next/link'
import { eq, and, or, ilike, isNull, isNotNull, desc, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albumCandidates, albums, events } from '@the-tool-pit/db'
import type { AlbumCandidateMetadata, AlbumEventMatch } from '@the-tool-pit/db'
import { AlbumCandidateActions } from './candidate-actions'
import { assertAdmin } from '@/lib/admin/auth'

// Real candidate statuses plus two views: "submitted" = candidates from public
// submissions (any status), and "no_cover" = published albums missing a cover
// image (Drive/Dropbox/blocked-Flickr that couldn't be OG-scraped).
const STATUS_TABS = ['pending', 'submitted', 'matched', 'no_cover', 'suppressed', 'duplicate', 'published'] as const
type TabStatus = (typeof STATUS_TABS)[number]
const TAB_LABELS: Record<TabStatus, string> = {
  pending: 'pending',
  submitted: 'submitted',
  matched: 'matched',
  no_cover: 'no cover',
  suppressed: 'suppressed',
  duplicate: 'duplicate',
  published: 'published',
}
const PAGE_SIZE = 30

export default async function AdminAlbumCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>
}) {
  await assertAdmin()
  const params = await searchParams
  const status = (STATUS_TABS.includes(params.status as TabStatus) ? params.status : 'pending') as TabStatus
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE
  const q = params.q?.trim() ?? ''

  const db = getDb()

  // "no_cover" = published rows whose album has no cover image; "submitted" =
  // candidates that came from a public submission (any status).
  const statusFilter: SQL =
    status === 'no_cover'
      ? and(eq(albumCandidates.status, 'published'), isNull(albums.coverImageUrl))!
      : status === 'submitted'
        ? isNotNull(albumCandidates.submissionId)
        : eq(albumCandidates.status, status)

  const searchFilter: SQL | undefined = q
    ? or(
        ilike(albumCandidates.canonicalUrl, `%${q}%`),
        ilike(albumCandidates.sourceUrl, `%${q}%`),
        sql`${albumCandidates.rawMetadata}->>'title' ilike ${`%${q}%`}`,
        ilike(events.name, `%${q}%`),
        ilike(events.eventCode, `%${q}%`),
      )
    : undefined
  const where = searchFilter ? and(statusFilter, searchFilter)! : statusFilter

  const [rows, [{ total }], counts, [{ noCover }], submittedCount] = await Promise.all([
    db
      .select({
        candidate: albumCandidates,
        eventName: events.name,
        eventCode: events.eventCode,
        eventYear: events.year,
        albumCover: albums.coverImageUrl,
      })
      .from(albumCandidates)
      .leftJoin(events, eq(events.id, albumCandidates.matchedEventId))
      .leftJoin(albums, eq(albums.id, albumCandidates.matchedAlbumId))
      .where(where)
      // Published: newest publish first. Other tabs: newest discovery first.
      .orderBy(status === 'published' ? desc(albums.publishedAt) : desc(albumCandidates.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(albumCandidates)
      .leftJoin(events, eq(events.id, albumCandidates.matchedEventId))
      .leftJoin(albums, eq(albums.id, albumCandidates.matchedAlbumId))
      .where(where),
    db
      .select({ status: albumCandidates.status, count: sql<number>`count(*)::int` })
      .from(albumCandidates)
      .groupBy(albumCandidates.status),
    db
      .select({ noCover: sql<number>`count(*)::int` })
      .from(albumCandidates)
      .leftJoin(albums, eq(albums.id, albumCandidates.matchedAlbumId))
      .where(and(eq(albumCandidates.status, 'published'), isNull(albums.coverImageUrl))),
    db
      .select({ submitted: sql<number>`count(*)::int` })
      .from(albumCandidates)
      .where(isNotNull(albumCandidates.submissionId)),
  ])

  const countMap: Record<string, number> = Object.fromEntries(counts.map((r) => [r.status, r.count]))
  countMap.no_cover = noCover
  countMap.submitted = submittedCount[0]?.submitted ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Album Candidates</h1>
        <p className="text-sm text-muted">{total.toLocaleString()} {TAB_LABELS[status]}</p>
      </div>

      <form method="get" className="flex gap-2">
        <input type="hidden" name="status" value={status} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by title, URL, or event name/code…"
          className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <button className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-foreground">
          Search
        </button>
        {q && (
          <Link
            href={`/admin/album-candidates?status=${status}`}
            className="rounded-lg px-3 py-2 text-sm text-muted-2 hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="flex gap-1 border-b border-border-subtle">
        {STATUS_TABS.map((s) => (
          <Link
            key={s}
            href={`/admin/album-candidates?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm capitalize transition-colors ${
              status === s ? 'border-b-2 border-primary text-primary' : 'text-muted hover:text-foreground'
            }`}
          >
            {TAB_LABELS[s]}
            {countMap[s] != null && (
              <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">{countMap[s]}</span>
            )}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{q ? `No matches for "${q}".` : `No ${TAB_LABELS[status]} candidates.`}</p>
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
              {rows.map(({ candidate: row, eventName, eventCode, eventYear }) => {
                const meta = (row.rawMetadata ?? {}) as AlbumCandidateMetadata
                const cls = (row.classification ?? {}) as Partial<AlbumEventMatch>
                const displayUrl = row.canonicalUrl ?? row.sourceUrl
                return (
                  <tr
                    key={row.id}
                    id={`album-${row.id}`}
                    className="border-t border-border-subtle align-top scroll-mt-6 hover:bg-surface"
                  >
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
                        {[row.provider, meta.photographer, meta.dateText].filter(Boolean).join(' · ')}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {eventName ? (
                        <span className="flex items-center gap-2 text-xs">
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-sm font-bold text-primary">
                            {eventYear}
                          </span>
                          <span className="text-foreground">
                            {eventName} <span className="font-mono text-muted-2">({eventCode})</span>
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-2">
                          {row.targetEventCode
                            ? `target: ${row.targetEventCode}${row.targetEventYear ? ` (${row.targetEventYear})` : ''}`
                            : 'unmatched'}
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
                        targetEventYear={row.targetEventYear}
                        matchedEventKey={eventCode && eventYear ? `${eventYear}${eventCode}` : null}
                        albumTitle={meta.title ?? ''}
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
              href={`/admin/album-candidates?status=${status}&page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              ← Prev
            </Link>
          )}
          <span className="px-3 py-1.5 text-xs text-muted">{page} / {totalPages}</span>
          {page < totalPages && (
            <Link
              href={`/admin/album-candidates?status=${status}&page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
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
