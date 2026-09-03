import Link from 'next/link'
import { notFound } from 'next/navigation'
import { assertAdmin } from '@/lib/admin/auth'
import { getReadDetail } from '../../../_listing/reads-data'
import { ReadDetailView } from '../../../_listing/reads-shared'

/** What one field-candidate read did: pages opened, evidence, rejects, fields. */

export const dynamic = 'force-dynamic'

export default async function FieldReadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await assertAdmin()
  const { id } = await params
  const detail = await getReadDetail('field', id)
  if (!detail) notFound()

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div>
        <Link href="/admin/practice-fields/reads" className="text-xs text-muted hover:text-foreground">
          ← Candidate reads
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-foreground">{detail.name}</h1>
      </div>

      <ReadDetailView detail={detail} />
    </div>
  )
}
