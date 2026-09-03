import Link from 'next/link'
import { assertAdmin } from '@/lib/admin/auth'
import { ReadsTabs } from '../../../_listing/reads-shared'
import { CrawlJobsPanel } from '../../../crawls/crawl-jobs'

/** The discovery crawl-jobs tab of the off-season events Reads & crawls inspector. */

export const dynamic = 'force-dynamic'

export default async function EventCrawlJobsTab() {
  await assertAdmin()

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div>
        <Link href="/admin/event-listings" className="text-xs text-muted hover:text-foreground">
          ← Off-season events
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">Reads &amp; crawls</h1>
      </div>

      <ReadsTabs vertical="events" active="crawls" />

      <CrawlJobsPanel vertical="events" />
    </div>
  )
}
