import Link from 'next/link'
import { Pager } from '@/components/admin/pager'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { grantCandidates, grantSources, grants } from '@the-tool-pit/db'
import type { GrantClassification, RawGrantMetadata } from '@the-tool-pit/db'
import { GrantCandidateActions } from './candidate-actions'

/**
 * The discovery queue. Every row here is a page a crawler thought might be a
 * grant, and none of them are visible to a team. The only way out of this
 * screen and onto the public list is the publish editor, which is a form a
 * person fills in.
 *
 * The classifier's verdict is shown with its reasoning next to it on purpose.
 * A confidence number on its own invites rubber-stamping; the sentence that
 * produced it is what makes a wrong call obvious in a second.
 */

// 'flagged' sits next to pending because it is not a rejection: it is a row a
// moderator wants back with better data, and it is the one tab that fills
// itself up if the deeper re-read keeps coming back thin.
const STATUS_TABS = ['pending', 'flagged', 'matched', 'published', 'suppressed', 'duplicate'] as const
type TabStatus = (typeof STATUS_TABS)[number]
const PAGE_SIZE = 25

export default async function AdminGrantCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>
}) {
  await assertAdmin()

  const params = await searchParams
  const status = (STATUS_TABS.includes(params.status as TabStatus) ? params.status : 'pending') as TabStatus
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const q = params.q?.trim() ?? ''
  const db = getDb()

  const statusFilter: SQL = eq(grantCandidates.status, status)
  const searchFilter: SQL | undefined = q
    ? or(
        ilike(grantCandidates.sourceUrl, `%${q}%`),
        ilike(grantCandidates.canonicalUrl, `%${q}%`),
        sql`${grantCandidates.rawMetadata}->>'title' ilike ${`%${q}%`}`,
        sql`${grantCandidates.rawMetadata}->>'funderName' ilike ${`%${q}%`}`,
        sql`${grantCandidates.classification}->>'name' ilike ${`%${q}%`}`,
      )
    : undefined
  const where = searchFilter ? and(statusFilter, searchFilter)! : statusFilter

  const [rows, [{ total }], counts] = await Promise.all([
    db
      .select({
        candidate: grantCandidates,
        sourceLabel: grantSources.label,
        sourceKind: grantSources.kind,
        grantSlug: grants.slug,
        grantName: grants.name,
      })
      .from(grantCandidates)
      .leftJoin(grantSources, eq(grantSources.id, grantCandidates.sourceId))
      .leftJoin(grants, eq(grants.id, grantCandidates.matchedGrantId))
      .where(where)
      // Highest confidence first inside the pending tab: the ones most likely
      // to be real grants are also the quickest to judge, so the queue drains
      // from the useful end rather than the noisy one.
      .orderBy(status === 'pending' ? desc(grantCandidates.confidenceScore) : desc(grantCandidates.updatedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(grantCandidates).where(where),
    db
      .select({ status: grantCandidates.status, count: sql<number>`count(*)::int` })
      .from(grantCandidates)
      .groupBy(grantCandidates.status),
  ])

  const countMap: Record<string, number> = Object.fromEntries(counts.map((r) => [r.status, r.count]))
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const qs = (extra: Record<string, string | number>) =>
    new URLSearchParams({ status, ...(q ? { q } : {}), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) }).toString()

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/grants" className="text-xs text-muted hover:text-foreground">
            ← Grants
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Grant candidates</h1>
        </div>
        <p className="text-sm text-muted">{total.toLocaleString()} {status}</p>
      </div>

      <p className="max-w-3xl text-xs text-muted-2">
        Nothing here is public. Review opens the deck: the whole record on one screen with the quote behind
        every value, three keys to approve, flag or suppress, and the next candidate straight after.
      </p>

      <form method="get" className="flex gap-2">
        <input type="hidden" name="status" value={status} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name, funder, or URL…"
          className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <button className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-foreground">
          Search
        </button>
        {q && (
          <Link
            href={`/admin/grants/candidates?status=${status}`}
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
            href={`/admin/grants/candidates?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
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
        <p className="text-sm text-muted">{q ? `No matches for "${q}".` : `No ${status} candidates.`}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="overflow-x-auto">
            <table className="min-w-[36rem] w-full text-sm">
                        <thead className="bg-surface-2 text-xs text-muted">
                          <tr>
                            <th className="px-4 py-2 text-left">Page</th>
                            <th className="w-72 px-4 py-2 text-left">Classifier</th>
                            <th className="w-44 px-4 py-2 text-left">Found by</th>
                            <th className="w-72 px-4 py-2 text-right">Decision</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ candidate: row, sourceLabel, sourceKind, grantSlug, grantName }) => {
                            const meta = (row.rawMetadata ?? {}) as RawGrantMetadata
                            const cls = (row.classification ?? {}) as GrantClassification
                            const url = row.canonicalUrl ?? row.sourceUrl
                            return (
                              <tr
                                key={row.id}
                                id={`grant-${row.id}`}
                                className="border-t border-border-subtle align-top scroll-mt-6 hover:bg-surface"
                              >
                                <td className="max-w-sm px-4 py-3">
                                  <span className="line-clamp-2 text-xs font-medium text-foreground">
                                    {cls.name || meta.title || url}
                                  </span>
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-0.5 block line-clamp-1 break-all text-[10px] text-muted hover:underline"
                                  >
                                    {url}
                                  </a>
                                  {(cls.funderName || meta.funderName) && (
                                    <p className="mt-1 text-[10px] text-muted-2">
                                      funder: {cls.funderName || meta.funderName}
                                    </p>
                                  )}
                                  {grantSlug && (
                                    <p className="mt-1 text-[10px] text-muted-2">
                                      attached to{' '}
                                      <Link href={`/admin/grants/${row.matchedGrantId}`} className="text-primary hover:underline">
                                        {grantName ?? grantSlug}
                                      </Link>
                                    </p>
                                  )}
                                  {/* This column doubles as the audit line. It is red for a
                                      rejection and muted for a routing note, because a
                                      candidate turned into a crawl source was a good find,
                                      not a reject. */}
                                  {row.rejectionReason && (
                                    <p
                                      className={`mt-1 text-[10px] ${
                                        row.status === 'matched' ? 'text-muted-2' : 'text-frc'
                                      }`}
                                    >
                                      {row.rejectionReason}
                                    </p>
                                  )}
                                </td>

                                <td className="px-4 py-3">
                                  <Verdict cls={cls} score={row.confidenceScore} />
                                </td>

                                <td className="px-4 py-3">
                                  <p className="text-[10px] text-foreground">{sourceLabel ?? 'no source row'}</p>
                                  <p className="text-[10px] text-muted-2">{sourceKind ?? 'unknown kind'}</p>
                                  {meta.discoveredVia && (
                                    <p className="mt-1 line-clamp-3 text-[10px] text-muted-2" title={meta.discoveredVia}>
                                      via {meta.discoveredVia}
                                    </p>
                                  )}
                                  {row.submitterName && (
                                    <p className="mt-1 text-[10px] text-muted-2">submitted by {row.submitterName}</p>
                                  )}
                                  <p className="mt-1 text-[10px] text-muted-2">{new Date(row.createdAt).toLocaleDateString()}</p>
                                </td>

                                <td className="px-4 py-3 text-right">
                                  <GrantCandidateActions
                                    candidateId={row.id}
                                    status={row.status}
                                    matchedGrantSlug={grantSlug ?? null}
                                    isAggregator={cls.isAggregator === true}
                                  />
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
          </div>
        </div>
      )}

      <Pager page={page} totalPages={totalPages} href={(n) => `/admin/grants/candidates?${qs({ page: n })}`} />
    </div>
  )
}

/**
 * The classifier's answer in full: what it decided, how sure it was, and why.
 *
 * isAnnouncement and isAggregator get their own badges because they are the two
 * failure modes that look most like a grant. An award announcement is written in
 * the same words as an open call, and a list-of-grants page publishes as one
 * grant with a name nobody can apply for.
 */
function Verdict({ cls, score }: { cls: GrantClassification; score: number | null }) {
  const pct = score != null ? `${Math.round(score * 100)}%` : cls.confidence != null ? `${Math.round(cls.confidence * 100)}%` : '-'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            cls.isGrant === true
              ? 'bg-rookie/15 text-rookie'
              : cls.isGrant === false
                ? 'bg-frc/15 text-frc'
                : 'bg-surface-3 text-muted'
          }`}
        >
          {cls.isGrant === true ? 'grant' : cls.isGrant === false ? 'not a grant' : 'unclassified'}
        </span>
        {cls.isAnnouncement && (
          <span className="rounded bg-official/15 px-1.5 py-0.5 text-[10px] text-official">announcement</span>
        )}
        {cls.isAggregator && (
          <span className="rounded bg-official/15 px-1.5 py-0.5 text-[10px] text-official">list page</span>
        )}
        <span className="text-[10px] text-muted-2">confidence {pct}</span>
      </div>
      {cls.reasoning ? (
        <p className="text-[10px] leading-snug text-muted">{cls.reasoning}</p>
      ) : (
        <p className="text-[10px] text-muted-2">No reasoning recorded. Read the page yourself before publishing.</p>
      )}
    </div>
  )
}
