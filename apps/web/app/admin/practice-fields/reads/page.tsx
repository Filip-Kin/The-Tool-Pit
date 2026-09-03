import Link from 'next/link'
import { Pager } from '@/components/admin/pager'
import { assertAdmin } from '@/lib/admin/auth'
import { getWorkerQueueBacklog } from '@/lib/admin/queue-counts'
import { getReadsList, getReadsOverview } from '../../_listing/reads-data'
import { ReadsProgress, ReadsListRows, ReadsTabs } from '../../_listing/reads-shared'
import { ReadsLive } from '../../_listing/reads-live'

/**
 * What the AI reader has done to the practice-field candidates: progress, the
 * live reading queue, and every candidate with the shape of its read. Click a
 * row to see exactly what that one read did.
 *
 * The reader is one worker queue (read-candidates) shared with the events
 * vertical, so the queue chips here mirror the events page; the progress bar is
 * this vertical's own.
 */

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

export default async function FieldReadsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  await assertAdmin()
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10))

  const [overview, list, queues] = await Promise.all([
    getReadsOverview('field'),
    getReadsList('field', page, PAGE_SIZE),
    getWorkerQueueBacklog(),
  ])
  const queue = queues.find((q) => q.key === 'read-candidates') ?? null
  const totalPages = Math.ceil(list.total / PAGE_SIZE)
  const sweepRunning = Boolean(queue && (queue.active > 0 || queue.waiting > 0))

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      {sweepRunning && <ReadsLive />}

      <div>
        <Link href="/admin/practice-fields" className="text-xs text-muted hover:text-foreground">
          ← Practice fields
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">Reads &amp; crawls</h1>
      </div>

      <ReadsTabs vertical="fields" active="reads" />

      <ReadsProgress overview={overview} queue={queue} />

      <ReadsListRows rows={list.rows} basePath="/admin/practice-fields/reads" />

      <Pager page={page} totalPages={totalPages} href={(n) => `/admin/practice-fields/reads?page=${n}`} />
    </div>
  )
}
