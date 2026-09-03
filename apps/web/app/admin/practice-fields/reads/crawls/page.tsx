import Link from 'next/link'
import { assertAdmin } from '@/lib/admin/auth'
import { ReadsTabs } from '../../../_listing/reads-shared'
import { CrawlJobsPanel } from '../../../crawls/crawl-jobs'

/** The discovery crawl-jobs tab of the practice-fields Reads & crawls inspector. */

export const dynamic = 'force-dynamic'

export default async function FieldCrawlJobsTab() {
  await assertAdmin()

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div>
        <Link href="/admin/practice-fields" className="text-xs text-muted hover:text-foreground">
          ← Practice fields
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">Reads &amp; crawls</h1>
      </div>

      <ReadsTabs vertical="fields" active="crawls" />

      <CrawlJobsPanel vertical="fields" />
    </div>
  )
}
