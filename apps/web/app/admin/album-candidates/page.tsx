import Link from 'next/link'
import { Pager } from '@/components/admin/pager'
import { eq, and, or, ilike, isNull, isNotNull, desc, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albumCandidates, albums, events } from '@the-tool-pit/db'
import type { AlbumCandidateMetadata, AlbumEventMatch } from '@the-tool-pit/db'
import { AlbumCandidateActions } from './candidate-actions'
import { BulkSuppressUnmatched } from './bulk-suppress-unmatched'
import { assertAdmin } from '@/lib/admin/auth'

// Real candidate statuses plus three views: "unmatched" = crawled pending rows
// the machine could not tie to an event (the stuck backlog - split out from
// genuinely-actionable pending), "submitted" = candidates from public
// submissions (any status), and "no_cover" = published albums missing a cover
// image (Drive/Dropbox/blocked-Flickr that couldn't be OG-scraped).
const STATUS_TABS = ['pending', 'unmatched', 'submitted', 'matched', 'no_cover', 'suppressed', 'duplicate', 'published'] as const
type TabStatus = (typeof STATUS_TABS)[number]
const TAB_LABELS: Record<TabStatus, string> = {
  pending: 'pending',
  unmatched: 'needs event',
  submitted: 'submitted',
  matched: 'matched',
  no_cover: 'no cover',
  suppressed: 'suppressed',
  duplicate: 'duplicate',
  published: 'published',
}
const PAGE_SIZE = 30

// The candidate's `classification` jsonb: the schema's AlbumEventMatch plus the
// machine's best-guess event (written by album-enrich even below the auto-match
// bar) so the queue can show it by name + score for one-click confirmation.
type AlbumCandidateClassification = Partial<AlbumEventMatch> & {
  guessEventId?: string | null
  guessEventCode?: string | null
  guessEventName?: string | null
  guessConfidence?: number
}

export default async function AdminAlbumCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string; reason?: string }>
}) {
  await assertAdmin()
  const params = await searchParams
  const status = (STATUS_TABS.includes(params.status as TabStatus) ? params.status : 'pending') as TabStatus
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE
  const q = params.q?.trim() ?? ''
  // Filter the suppressed tab by rejection_reason, so the owner can audit what
  // got auto-suppressed and why (open_alliance, not_a_photo_album, dead_link,
  // fll_no_event_mapping, ...). Only meaningful on the suppressed tab.
  const reason = status === 'suppressed' ? (params.reason?.trim() ?? '') : ''

  const db = getDb()

  // "no_cover" = published rows whose album has no cover image; "submitted" =
  // candidates that came from a public submission (any status); "unmatched" =
  // crawled pending rows with no event (the machine gave up - the stuck backlog).
  const unmatchedFilter: SQL = and(
    eq(albumCandidates.status, 'pending'),
    isNull(albumCandidates.matchedEventId),
    isNull(albumCandidates.submissionId),
  )!
  const statusFilter: SQL =
    status === 'no_cover'
      ? and(eq(albumCandidates.status, 'published'), isNull(albums.coverImageUrl))!
      : status === 'submitted'
        ? isNotNull(albumCandidates.submissionId)
        : status === 'unmatched'
          ? unmatchedFilter
          : status === 'suppressed' && reason
            ? and(eq(albumCandidates.status, 'suppressed'), eq(albumCandidates.rejectionReason, reason))!
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

  const [rows, [{ total }], counts, [{ noCover }], submittedCount, [unmatchedAgg], reasonCounts] = await Promise.all([
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
    db
      .select({
        count: sql<number>`count(*)::int`,
        oldest: sql<string | null>`min(${albumCandidates.createdAt})`,
      })
      .from(albumCandidates)
      .where(unmatchedFilter),
    // Distinct rejection_reason breakdown of the suppressed tab, for the audit
    // chips. Every auto-suppress reason (junk gate, dead link, FLL) shows here.
    db
      .select({
        reason: sql<string>`coalesce(${albumCandidates.rejectionReason}, '')`,
        count: sql<number>`count(*)::int`,
      })
      .from(albumCandidates)
      .where(eq(albumCandidates.status, 'suppressed'))
      .groupBy(sql`coalesce(${albumCandidates.rejectionReason}, '')`)
      .orderBy(desc(sql`count(*)`)),
  ])

  const countMap: Record<string, number> = Object.fromEntries(counts.map((r) => [r.status, r.count]))
  countMap.no_cover = noCover
  countMap.submitted = submittedCount[0]?.submitted ?? 0
  const unmatchedCount = unmatchedAgg?.count ?? 0
  countMap.unmatched = unmatchedCount
  // Days since the oldest stuck candidate, for the "queue is N days stale" note.
  const oldestUnmatched = unmatchedAgg?.oldest ? new Date(unmatchedAgg.oldest) : null
  const staleDays = oldestUnmatched
    ? Math.floor((Date.now() - oldestUnmatched.getTime()) / 86_400_000)
    : 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
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

      <div className="flex flex-wrap gap-x-1 border-b border-border-subtle">
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

      {status === 'unmatched' && unmatchedCount > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            {unmatchedCount.toLocaleString()} crawled album{unmatchedCount === 1 ? '' : 's'} the matcher could not tie to an event
            {staleDays > 0 && <>, oldest <span className="font-medium text-foreground">{staleDays} days</span> old</>}.
            Set an event to publish one, or clear the backlog.
          </p>
          <BulkSuppressUnmatched count={unmatchedCount} />
        </div>
      )}

      {status === 'suppressed' && reasonCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-2">reason:</span>
          <Link
            href={`/admin/album-candidates?status=suppressed${q ? `&q=${encodeURIComponent(q)}` : ''}`}
            className={`rounded-full px-2 py-0.5 text-xs ${
              reason ? 'text-muted hover:text-foreground' : 'bg-primary/15 text-primary'
            }`}
          >
            all
          </Link>
          {reasonCounts.map((r) => {
            const label = r.reason || 'none'
            return (
              <Link
                key={label}
                href={`/admin/album-candidates?status=suppressed&reason=${encodeURIComponent(r.reason)}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs ${
                  reason === r.reason ? 'bg-primary/15 text-primary' : 'text-muted hover:text-foreground'
                }`}
              >
                {label}
                <span className="rounded-full bg-surface-3 px-1 text-[10px] text-muted">{r.count}</span>
              </Link>
            )
          })}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{q ? `No matches for "${q}".` : `No ${TAB_LABELS[status]} candidates.`}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {/* No inner horizontal scroll: on a phone each row STACKS (flex-col) so
              the Event control is reachable; md+ is a normal table. */}
          <table className="w-full text-sm">
                        <thead className="hidden bg-surface-2 text-xs text-muted md:table-header-group">
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
                            const cls = (row.classification ?? {}) as AlbumCandidateClassification
                            const displayUrl = row.canonicalUrl ?? row.sourceUrl
                            const guessPct = cls.guessConfidence != null ? Math.round(cls.guessConfidence * 100) : null
                            const program = meta.targetProgram === 'ftc' ? 'ftc' : 'frc'
                            return (
                              <tr
                                key={row.id}
                                id={`album-${row.id}`}
                                className="flex flex-col gap-2 border-t border-border-subtle p-3 hover:bg-surface md:table-row md:gap-0 md:p-0 md:align-top md:scroll-mt-6"
                              >
                                <td className="block md:table-cell md:max-w-xs md:px-4 md:py-3">
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
                                <td className="block md:table-cell md:px-4 md:py-3">
                                  {eventName ? (
                                    <span className="flex items-center gap-2 text-xs">
                                      <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-sm font-bold text-primary">
                                        {eventYear}
                                      </span>
                                      <span className="text-foreground">
                                        {eventName} <span className="font-mono text-muted-2">({eventCode})</span>
                                      </span>
                                    </span>
                                  ) : cls.guessEventName ? (
                                    // Machine's best guess, shown by NAME + score so a moderator can
                                    // eyeball it and confirm below without researching a code.
                                    <span className="flex flex-col gap-0.5 text-xs">
                                      <span className="text-[10px] uppercase tracking-wide text-muted-2">best guess</span>
                                      <span className="text-foreground">
                                        {cls.guessEventName}
                                        {cls.guessEventCode && (
                                          <span className="ml-1 font-mono text-muted-2">({cls.guessEventCode})</span>
                                        )}
                                        {guessPct != null && <span className="ml-1 text-muted-2">· {guessPct}%</span>}
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
                                <td className="block md:table-cell md:px-4 md:py-3">
                                  <span className="text-[10px] text-muted-2">{cls.method ?? '-'}</span>
                                </td>
                                <td className="block md:table-cell md:px-4 md:py-3 md:text-right">
                                  <AlbumCandidateActions
                                    candidateId={row.id}
                                    status={row.status}
                                    hasEvent={Boolean(row.matchedEventId)}
                                    fromSubmission={Boolean(row.submissionId)}
                                    program={program}
                                    targetEventCode={row.targetEventCode}
                                    targetEventYear={row.targetEventYear}
                                    matchedEventKey={eventCode && eventYear ? `${eventYear}${eventCode}` : null}
                                    guessEventKey={cls.guessEventCode ?? null}
                                    guessEventName={cls.guessEventName ?? null}
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

      <Pager page={page} totalPages={totalPages} href={(n) => `/admin/album-candidates?status=${status}&page=${n}${q ? `&q=${encodeURIComponent(q)}` : ''}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`} />
    </div>
  )
}
