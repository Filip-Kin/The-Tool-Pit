import { assertAdmin } from '@/lib/admin/auth'
import { CrawlJobsTable, LIMIT, VERTICALS, loadAllJobs, loadJobs, type VerticalKey } from './crawl-jobs'
import Link from 'next/link'

/**
 * Every vertical's crawl runs, on one screen with a filter.
 *
 * ONE PAGE, NOT FIVE. The five job tables have the same columns, so five routes
 * would be the same table five times with a different import at the top. The
 * question this screen answers is also usually cross-vertical: the overnight
 * sweeps land within two hours of each other, and "did anything run last night,
 * and did anything blow up" is one look, not five.
 *
 * NO VERTICAL VALUE MEANS ALL FIVE, merged newest first. Each vertical also has
 * its own "Crawl jobs" tab now, inside its Reads & crawls inspector, filtered to
 * that vertical; this stays the all-verticals view under System.
 *
 * The loaders and the table itself live in ./crawl-jobs so the per-vertical tabs
 * render the same table.
 */

export const dynamic = 'force-dynamic'

export default async function CrawlJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ vertical?: string }>
}) {
  await assertAdmin()
  const params = await searchParams
  const vertical = VERTICALS.find((v) => v.key === params.vertical) ?? null
  const active: VerticalKey | null = vertical?.key ?? null
  const jobs = active ? await loadJobs(active) : await loadAllJobs()

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {vertical ? `${vertical.label} crawl jobs` : 'Crawl jobs'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {vertical
              ? `The last ${LIMIT} runs. Pick another vertical in the sidebar.`
              : `The last ${LIMIT} runs across all five verticals, newest first.`}
          </p>
        </div>
        {vertical && (
          <Link href={vertical.sourcesHref} className="text-xs text-primary hover:underline">
            {vertical.label} sources →
          </Link>
        )}
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted">No runs recorded. Sweeps are scheduled; you can also start one by hand from sources.</p>
      ) : (
        <CrawlJobsTable jobs={jobs} showVertical={!active} />
      )}
    </div>
  )
}
