import Link from 'next/link'
import { Pager } from '@/components/admin/pager'
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { grantCycles, grantFunders, grants } from '@the-tool-pit/db'

/**
 * The grants admin index: every listing we hold.
 *
 * The three queues that feed it (Changes, Candidates, Sources) used to be
 * repeated here as a row of cards, which was the sidebar's Grants group said
 * twice. The counts that made the cards worth having now sit on the sidebar
 * entries themselves, so this page is the list and nothing else.
 */

const STATUS_TABS = ['published', 'pending', 'unverified', 'suppressed', 'archived'] as const
type TabStatus = (typeof STATUS_TABS)[number]
const PAGE_SIZE = 40

export default async function AdminGrantsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; published?: string }>
}) {
  await assertAdmin()
  const params = await searchParams
  const status = (STATUS_TABS.includes(params.status as TabStatus) ? params.status : 'published') as TabStatus
  const q = params.q?.trim() ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const db = getDb()

  // "unverified" is a view, not a stored status: anything nobody has ever
  // confirmed by hand. It is separated out because it is the queue of listings
  // whose "verified on" line cannot be shown, which is what a team judges.
  const statusFilter: SQL =
    status === 'unverified' ? isNull(grants.verifiedAt) : eq(grants.status, status)
  const searchFilter: SQL | undefined = q
    ? or(ilike(grants.name, `%${q}%`), ilike(grants.slug, `%${q}%`), ilike(grants.infoUrl, `%${q}%`), ilike(grantFunders.name, `%${q}%`))
    : undefined
  const where = searchFilter ? and(statusFilter, searchFilter)! : statusFilter

  const [rows, [{ total }]] =
    await Promise.all([
      db
        .select({
          grant: grants,
          funderName: grantFunders.name,
          nextDeadline: sql<string | null>`(
            select min(${grantCycles.deadlineAt})
            from ${grantCycles}
            where ${grantCycles.grantId} = ${grants.id} and ${grantCycles.deadlineAt} > now()
          )`,
        })
        .from(grants)
        .leftJoin(grantFunders, eq(grantFunders.id, grants.funderId))
        .where(where)
        .orderBy(status === 'published' ? asc(grants.name) : desc(grants.updatedAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db.select({ total: sql<number>`count(*)::int` }).from(grants).leftJoin(grantFunders, eq(grantFunders.id, grants.funderId)).where(where),
    ])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Grants</h1>
        <p className="text-sm text-muted">{total.toLocaleString()} {status}</p>
      </div>

      {params.published && (
        <p className="rounded-lg border border-rookie/40 bg-rookie/10 p-3 text-sm text-rookie">
          Saved as /grants/{params.published}. It is not public until its status is published.
        </p>
      )}

      <form method="get" className="flex gap-2">
        <input type="hidden" name="status" value={status} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name, slug, funder, or URL…"
          className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <button className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-foreground">
          Search
        </button>
        {q && (
          <Link href={`/admin/grants?status=${status}`} className="rounded-lg px-3 py-2 text-sm text-muted-2 hover:text-foreground">
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{q ? `No matches for "${q}".` : `No ${status} grants.`}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="overflow-x-auto">
            <table className="min-w-[36rem] w-full text-sm">
                        <thead className="bg-surface-2 text-xs text-muted">
                          <tr>
                            <th className="px-4 py-2 text-left">Grant</th>
                            <th className="w-44 px-4 py-2 text-left">Next deadline</th>
                            <th className="w-40 px-4 py-2 text-left">Verified</th>
                            <th className="w-32 px-4 py-2 text-left">Crawl</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(({ grant, funderName, nextDeadline }) => (
                            <tr key={grant.id} className="border-t border-border-subtle align-top hover:bg-surface">
                              <td className="max-w-md px-4 py-3">
                                <Link href={`/admin/grants/${grant.id}`} className="text-xs font-medium text-foreground hover:text-primary">
                                  {grant.name}
                                </Link>
                                <p className="mt-0.5 text-[10px] text-muted-2">
                                  /grants/{grant.slug}
                                  {funderName && ` · ${funderName}`}
                                  {` · ${grant.geoScope}`}
                                  {grant.regions.length > 0 && ` (${grant.regions.join(', ')})`}
                                </p>
                                {grant.status !== 'published' && (
                                  <span className="mt-1 inline-block rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">
                                    {grant.status}
                                  </span>
                                )}
                              </td>

                              <td className="px-4 py-3 text-[10px]">
                                {nextDeadline ? (
                                  <span className="text-foreground">
                                    {new Date(nextDeadline).toISOString().replace('.000Z', 'Z')} (UTC)
                                  </span>
                                ) : (
                                  <span className="text-muted-2">
                                    {grant.deadlineType === 'rolling' ? 'rolling, no deadline' : 'none recorded'}
                                  </span>
                                )}
                              </td>

                              <td className="px-4 py-3 text-[10px]">
                                {grant.verifiedAt ? (
                                  <>
                                    <span className="text-muted">{new Date(grant.verifiedAt).toLocaleDateString()}</span>
                                    <span className="block text-muted-2">{grant.verifiedBy ?? 'unknown'}</span>
                                  </>
                                ) : (
                                  <span className="text-official">never</span>
                                )}
                              </td>

                              <td className="px-4 py-3 text-[10px]">
                                <span className="text-muted-2">
                                  {grant.lastCheckedAt ? new Date(grant.lastCheckedAt).toLocaleDateString() : 'never fetched'}
                                </span>
                                {grant.checkFailureCount > 0 && (
                                  <span className="block text-frc">{grant.checkFailureCount} failures</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
          </div>
        </div>
      )}

      <Pager page={page} totalPages={totalPages} href={(n) => `/admin/grants?status=${status}&page=${n}${q ? `&q=${encodeURIComponent(q)}` : ''}`} />
    </div>
  )
}
