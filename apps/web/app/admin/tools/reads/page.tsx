import Link from 'next/link'
import { assertAdmin } from '@/lib/admin/auth'
import { ReadsTabs } from '../../_listing/reads-shared'
import { CrawlJobsPanel } from '../../crawls/crawl-jobs'

/**
 * The tools Reads & crawls inspector.
 *
 * Tools has no candidate-read pass of its own to surface, so this is the
 * discovery crawl-jobs tab alone. One observability entry per vertical, and this
 * is where a tools crawl run shows up.
 */

export const dynamic = 'force-dynamic'

export default async function ToolsReadsPage() {
  await assertAdmin()

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div>
        <Link href="/admin/tools" className="text-xs text-muted hover:text-foreground">
          ← Tools
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">Reads &amp; crawls</h1>
      </div>

      <ReadsTabs vertical="tools" active="crawls" />

      <CrawlJobsPanel vertical="tools" />
    </div>
  )
}
