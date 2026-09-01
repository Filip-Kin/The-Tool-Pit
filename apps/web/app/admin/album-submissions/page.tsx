import Link from 'next/link'
import { Pager } from '@/components/admin/pager'
import { desc, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albumSubmissions } from '@the-tool-pit/db'
import { assertAdmin } from '@/lib/admin/auth'

const PAGE_SIZE = 40

export default async function AdminAlbumSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  await assertAdmin()
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE
  const db = getDb()

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(albumSubmissions).orderBy(desc(albumSubmissions.createdAt)).limit(PAGE_SIZE).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(albumSubmissions),
  ])
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Album Submissions</h1>
        <p className="text-sm text-muted">{total.toLocaleString()} total</p>
      </div>
      <p className="text-sm text-muted">
        This is the raw submission log. Moderate submitted albums (set an event and
        publish) under{' '}
        <Link href="/admin/album-candidates?status=submitted" className="text-primary hover:underline">
          Album Candidates → Submitted
        </Link>
        .
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No submissions yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-4 py-2 text-left">URL</th>
                <th className="px-4 py-2 text-left">Event hint</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border-subtle align-top">
                  <td className="max-w-xs px-4 py-2">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="line-clamp-1 break-all text-xs text-primary hover:underline"
                    >
                      {r.url}
                    </a>
                    {r.submitterNote && <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-2">{r.submitterNote}</p>}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted">{r.eventHint ?? '-'}</td>
                  <td className="px-4 py-2 text-xs text-foreground">{r.status}</td>
                  <td className="px-4 py-2 text-xs text-muted-2">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager page={page} totalPages={totalPages} href={(n) => `/admin/album-submissions?page=${n}`} />
    </div>
  )
}
