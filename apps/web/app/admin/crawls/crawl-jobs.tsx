import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
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
import { StatusText } from '@/components/admin/status'
import { LocalTime } from '@/components/admin/local-time'

/**
 * The crawl-jobs loaders and table, shared by the all-verticals /admin/crawls
 * screen and the per-vertical "Crawl jobs" tab inside each Reads & crawls
 * inspector.
 *
 * ONE TABLE, MANY MOUNTS. The five job tables (crawl_jobs, album_crawl_jobs,
 * grant_crawl_jobs, event_listing_crawl_jobs, practice_field_crawl_jobs) have
 * the same seven columns, so the rendering lives here once and both the merged
 * System view and each vertical's own tab render it, rather than each rebuilding
 * a job table of its own.
 */

const VERTICALS = [
  { key: 'tools', label: 'Tools', sourcesHref: '/admin/sources' },
  { key: 'photos', label: 'Photos', sourcesHref: '/admin/album-sources' },
  { key: 'grants', label: 'Grants', sourcesHref: '/admin/grants/sources' },
  { key: 'events', label: 'Off-season events', sourcesHref: '/admin/event-listings/sources' },
  { key: 'fields', label: 'Practice fields', sourcesHref: '/admin/practice-fields/sources' },
] as const

export { VERTICALS }
export type VerticalKey = (typeof VERTICALS)[number]['key']

export const LIMIT = 50

export interface JobRow {
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
  /** Which table the row came from. Only shown in the merged view. */
  vertical: VerticalKey
}

/** All five, newest first, for the merged view. */
export async function loadAllJobs(): Promise<JobRow[]> {
  const perVertical = await Promise.all(VERTICALS.map((v) => loadJobs(v.key)))
  return perVertical
    .flat()
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, LIMIT)
}

export async function loadJobs(vertical: VerticalKey): Promise<JobRow[]> {
  const db = getDb()
  const bare = (rows: Omit<JobRow, 'sourceLabel' | 'vertical'>[]): JobRow[] =>
    rows.map((r) => ({ ...r, sourceLabel: null, vertical }))
  const tag = (rows: Omit<JobRow, 'vertical'>[]): JobRow[] => rows.map((r) => ({ ...r, vertical }))

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
    return tag(
      await db
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
        .limit(LIMIT),
    )
  }

  if (vertical === 'events') {
    return tag(
      await db
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
        .limit(LIMIT),
    )
  }

  return tag(
    await db
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
      .limit(LIMIT),
  )
}

/**
 * The seven-column job table. `showVertical` labels each row with the vertical
 * it ran for; the merged System view turns it on, a single-vertical tab leaves
 * it off. Times render in the viewer's zone via LocalTime.
 */
export function CrawlJobsTable({ jobs, showVertical }: { jobs: JobRow[]; showVertical: boolean }) {
  return (
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
                  {/* Merged view only: a connector name does not always say
                      which vertical ran it. */}
                  {showVertical && (
                    <p className="text-[10px] text-muted">
                      {VERTICALS.find((v) => v.key === job.vertical)?.label}
                    </p>
                  )}
                  {job.sourceLabel && <p className="text-[10px] text-muted-2">{job.sourceLabel}</p>}
                </td>
                <td className="px-4 py-2">
                  <StatusText status={job.status} />
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
                  <LocalTime value={job.startedAt ?? job.createdAt} />
                </td>
                <td className="px-4 py-2 text-[10px] text-muted-2">
                  {job.finishedAt ? <LocalTime value={job.finishedAt} /> : '-'}
                </td>
              </>
            )

            // Tools jobs have a detail page; the other four do not, and a
            // row that navigates to a 404 is worse than a row that does not
            // navigate. Checked per row, because the merged view mixes them.
            return job.vertical === 'tools' ? (
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
  )
}

/**
 * The body of a vertical's "Crawl jobs" tab: a one-line summary, a sources
 * shortcut, and this vertical's job table. Loads its own rows so a tab page is
 * a header plus this.
 */
export async function CrawlJobsPanel({ vertical }: { vertical: VerticalKey }) {
  const meta = VERTICALS.find((v) => v.key === vertical)!
  const jobs = await loadJobs(vertical)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">The last {LIMIT} {meta.label.toLowerCase()} crawl runs, newest first.</p>
        <Link href={meta.sourcesHref} className="text-xs text-primary hover:underline">
          {meta.label} sources →
        </Link>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted">
          No runs recorded. Sweeps are scheduled; you can also start one by hand from sources.
        </p>
      ) : (
        <CrawlJobsTable jobs={jobs} showVertical={false} />
      )}
    </div>
  )
}
