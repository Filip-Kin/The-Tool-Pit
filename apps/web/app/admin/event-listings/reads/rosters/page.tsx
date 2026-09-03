import Link from 'next/link'
import { Pager } from '@/components/admin/pager'
import { StatusChip } from '@/components/admin/status'
import { assertAdmin } from '@/lib/admin/auth'
import { formatDate } from '@/lib/format/date'
import { getWorkerQueueBacklog } from '@/lib/admin/queue-counts'
import { getRosterCrawls } from '../../../_listing/reads-rosters-data'
import { ReadsTabs } from '../../../_listing/reads-shared'

/**
 * The team-list crawl side of the events reads inspector.
 *
 * One row per published event with a roster source, newest refresh first: is a
 * parser written, how many teams the last approved snapshot counted, and when it
 * last refreshed. Click through to the latest snapshot the refresh produced.
 */

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

export default async function RosterCrawlsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  await assertAdmin()
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10))

  const [list, queues] = await Promise.all([getRosterCrawls(page, PAGE_SIZE), getWorkerQueueBacklog()])
  const queue = queues.find((q) => q.key === 'roster-refresh') ?? null
  const totalPages = Math.ceil(list.total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div>
        <Link href="/admin/event-listings" className="text-xs text-muted hover:text-foreground">
          ← Off-season events
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">Reads &amp; crawls</h1>
      </div>

      <ReadsTabs active="crawls" />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-foreground">{list.total.toLocaleString()} published events with a roster source</p>
        {queue && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-muted-2">refresh queue</span>
            <span className="rounded bg-surface-3 px-1.5 py-0.5 font-medium text-muted">{queue.waiting} waiting</span>
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${queue.active > 0 ? 'bg-official/20 text-official' : 'bg-surface-3 text-muted'}`}
            >
              {queue.active} active
            </span>
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${queue.failed > 0 ? 'bg-frc/15 text-frc' : 'bg-surface-3 text-muted'}`}
            >
              {queue.failed} failed
            </span>
          </div>
        )}
      </div>

      {list.rows.length === 0 ? (
        <p className="text-sm text-muted">No published events carry a team-list URL or a TBA key yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border bg-surface">
          {list.rows.map((row) => (
            <Link
              key={row.listingId}
              href={`/admin/event-listings/reads/rosters/${row.listingId}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
                <p className="text-[11px] text-muted-2">
                  {row.tbaKey ? `TBA ${row.tbaKey}` : row.hasParser ? 'site parser' : 'team-list page, no parser yet'}
                  {row.countUpdatedAt && ` · refreshed ${formatDate(row.countUpdatedAt)}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted-2">
                <span className="text-foreground">
                  {row.registeredTeamCount ?? '—'} teams
                </span>
                {row.lastSnapshotStatus && <StatusChip status={row.lastSnapshotStatus} />}
                <span aria-hidden>→</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Pager page={page} totalPages={totalPages} href={(n) => `/admin/event-listings/reads/rosters?page=${n}`} />
    </div>
  )
}
