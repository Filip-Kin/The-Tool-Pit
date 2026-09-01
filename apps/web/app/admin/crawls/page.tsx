import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import {
  albumCrawlJobs,
  crawlJobs,
  eventListingCrawlJobs,
  eventListingCrawlSources,
  grantCrawlJobs,
  grantSources,
  practiceFieldCrawlJobs,
  practiceFieldCrawlSources,
} from '@the-tool-pit/db'
import { ClickableRow } from '@/components/admin/clickable-row'

/**
 * Every vertical's crawl runs, on one screen with a filter.
 *
 * ONE PAGE, NOT FIVE. The five job tables (crawl_jobs, album_crawl_jobs,
 * grant_crawl_jobs, event_listing_crawl_jobs, practice_field_crawl_jobs) have
 * the same seven columns, so five routes would be the same table five times
 * with a different import at the top. The question this screen answers is also
 * usually cross-vertical: the overnight sweeps land within two hours of each
 * other, and "did anything run last night, and did anything blow up" is one
 * look, not five. Each vertical's sidebar entry links straight to its own tab.
 *
 * Only tools rows link out to a detail page, because only tools has one.
 */

export const dynamic = 'force-dynamic'

const VERTICALS = [
  { key: 'tools', label: 'Tools', sourcesHref: '/admin/sources' },
  { key: 'photos', label: 'Photos', sourcesHref: '/admin/album-sources' },
  { key: 'grants', label: 'Grants', sourcesHref: '/admin/grants/sources' },
  { key: 'events', label: 'Off-season events', sourcesHref: '/admin/event-listings/sources' },
  { key: 'fields', label: 'Practice fields', sourcesHref: '/admin/practice-fields/sources' },
] as const

type VerticalKey = (typeof VERTICALS)[number]['key']

const LIMIT = 50

interface JobRow {
  id: string
  connector: string
  status: string
  startedAt: Date | null
  finishedAt: Date | null
  /** Each vertical has its own stats interface; they are read by key here. */
  stats: unknown
  error: string | null
  createdAt: Date
  sourceLabel: string | null
}

async function loadJobs(vertical: VerticalKey): Promise<JobRow[]> {
  const db = getDb()
  const bare = (rows: Omit<JobRow, 'sourceLabel'>[]): JobRow[] => rows.map((r) => ({ ...r, sourceLabel: null }))

  if (vertical === 'tools') {
    return bare(
      await db
        .select({
          id: crawlJobs.id,
          connector: crawlJobs.connector,
          status: crawlJobs.status,
          startedAt: crawlJobs.startedAt,
          finishedAt: crawlJobs.finishedAt,
          stats: crawlJobs.stats,
          error: crawlJobs.error,
          createdAt: crawlJobs.createdAt,
        })
        .from(crawlJobs)
        .orderBy(desc(crawlJobs.createdAt))
        .limit(LIMIT),
    )
  }

  if (vertical === 'photos') {
    return bare(
      await db
        .select({
          id: albumCrawlJobs.id,
          connector: albumCrawlJobs.connector,
          status: albumCrawlJobs.status,
          startedAt: albumCrawlJobs.startedAt,
          finishedAt: albumCrawlJobs.finishedAt,
          stats: albumCrawlJobs.stats,
          error: albumCrawlJobs.error,
          createdAt: albumCrawlJobs.createdAt,
        })
        .from(albumCrawlJobs)
        .orderBy(desc(albumCrawlJobs.createdAt))
        .limit(LIMIT),
    )
  }

  if (vertical === 'grants') {
    return db
      .select({
        id: grantCrawlJobs.id,
        connector: grantCrawlJobs.connector,
        status: grantCrawlJobs.status,
        startedAt: grantCrawlJobs.startedAt,
        finishedAt: grantCrawlJobs.finishedAt,
        stats: grantCrawlJobs.stats,
        error: grantCrawlJobs.error,
        createdAt: grantCrawlJobs.createdAt,
        sourceLabel: grantSources.label,
      })
      .from(grantCrawlJobs)
      .leftJoin(grantSources, eq(grantSources.id, grantCrawlJobs.sourceId))
      .orderBy(desc(grantCrawlJobs.createdAt))
      .limit(LIMIT)
  }

  if (vertical === 'events') {
    return db
      .select({
        id: eventListingCrawlJobs.id,
        connector: eventListingCrawlJobs.connector,
        status: eventListingCrawlJobs.status,
        startedAt: eventListingCrawlJobs.startedAt,
        finishedAt: eventListingCrawlJobs.finishedAt,
        stats: eventListingCrawlJobs.stats,
        error: eventListingCrawlJobs.error,
        createdAt: eventListingCrawlJobs.createdAt,
        sourceLabel: eventListingCrawlSources.label,
      })
      .from(eventListingCrawlJobs)
      .leftJoin(eventListingCrawlSources, eq(eventListingCrawlSources.id, eventListingCrawlJobs.sourceId))
      .orderBy(desc(eventListingCrawlJobs.createdAt))
      .limit(LIMIT)
  }

  return db
    .select({
      id: practiceFieldCrawlJobs.id,
      connector: practiceFieldCrawlJobs.connector,
      status: practiceFieldCrawlJobs.status,
      startedAt: practiceFieldCrawlJobs.startedAt,
      finishedAt: practiceFieldCrawlJobs.finishedAt,
      stats: practiceFieldCrawlJobs.stats,
      error: practiceFieldCrawlJobs.error,
      createdAt: practiceFieldCrawlJobs.createdAt,
      sourceLabel: practiceFieldCrawlSources.label,
    })
    .from(practiceFieldCrawlJobs)
    .leftJoin(practiceFieldCrawlSources, eq(practiceFieldCrawlSources.id, practiceFieldCrawlJobs.sourceId))
    .orderBy(desc(practiceFieldCrawlJobs.createdAt))
    .limit(LIMIT)
}

export default async function CrawlJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ vertical?: string }>
}) {
  await assertAdmin()
  const params = await searchParams
  const active = (VERTICALS.find((v) => v.key === params.vertical)?.key ?? 'tools') as VerticalKey
  const vertical = VERTICALS.find((v) => v.key === active)!
  const jobs = await loadJobs(active)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-foreground">Crawl jobs</h1>
        <Link href={vertical.sourcesHref} className="text-xs text-primary hover:underline">
          {vertical.label} sources →
        </Link>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border-subtle">
        {VERTICALS.map((v) => (
          <Link
            key={v.key}
            href={`/admin/crawls?vertical=${v.key}`}
            className={`whitespace-nowrap px-3 py-2 text-sm transition-colors ${
              active === v.key ? 'border-b-2 border-primary text-primary' : 'text-muted hover:text-foreground'
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted">No runs recorded. Sweeps are scheduled; you can also start one by hand from sources.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-4 py-2 text-left">Connector</th>
                <th className="w-24 px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Result</th>
                <th className="w-44 px-4 py-2 text-left">Started</th>
                <th className="w-44 px-4 py-2 text-left">Finished</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const stats = (job.stats ?? {}) as Record<string, unknown>
                const n = (k: string) => (typeof stats[k] === 'number' ? (stats[k] as number) : 0)
                const limits = Array.isArray(stats.limits) ? (stats.limits as string[]) : []
                const errors = Array.isArray(stats.errors) ? (stats.errors as string[]) : []
                const cells = (
                  <>
                    <td className="px-4 py-2">
                      <p className="font-mono text-xs text-foreground">{job.connector}</p>
                      {job.sourceLabel && <p className="text-[10px] text-muted-2">{job.sourceLabel}</p>}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-2 text-[10px] text-muted">
                      {job.stats ? (
                        <p>
                          {n('discovered')} found, {n('new')} new, {n('unchanged')} known, {n('skipped')} skipped,{' '}
                          {n('failed')} failed
                        </p>
                      ) : (
                        <p className="text-muted-2">no counts recorded</p>
                      )}
                      {job.error && <p className="mt-1 text-frc">{job.error.slice(0, 160)}</p>}
                      {/* A cap that bit is shown, never swallowed: a run cut off
                          by a per-run limit is a partial sweep, and reading it
                          as a complete one is how coverage silently shrinks. */}
                      {limits.map((l) => (
                        <p key={l} className="mt-1 text-official">
                          coverage limit: {l}
                        </p>
                      ))}
                      {errors.slice(0, 3).map((e) => (
                        <p key={e} className="mt-1 text-frc">
                          {e.slice(0, 160)}
                        </p>
                      ))}
                      {errors.length > 3 && <p className="mt-1 text-muted-2">and {errors.length - 3} more errors</p>}
                    </td>
                    <td className="px-4 py-2 text-[10px] text-muted-2">
                      {job.startedAt ? new Date(job.startedAt).toLocaleString() : new Date(job.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-[10px] text-muted-2">
                      {job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '-'}
                    </td>
                  </>
                )

                // Tools jobs have a detail page; the other four do not, and a
                // row that navigates to a 404 is worse than a row that does not
                // navigate.
                return active === 'tools' ? (
                  <ClickableRow
                    key={job.id}
                    href={`/admin/crawls/${job.id}`}
                    className="border-t border-border-subtle align-top hover:bg-surface"
                  >
                    {cells}
                  </ClickableRow>
                ) : (
                  <tr key={job.id} className="border-t border-border-subtle align-top">
                    {cells}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    done: 'text-rookie',
    running: 'text-official',
    failed: 'text-frc',
    queued: 'text-muted',
  }
  return <span className={`text-xs font-medium ${colors[status] ?? 'text-muted'}`}>{status}</span>
}
