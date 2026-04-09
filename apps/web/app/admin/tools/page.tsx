import { getDb } from '@/lib/db'
import { tools, toolPrograms, programs } from '@the-tool-pit/db'
import { eq, sql, desc, inArray, ilike, and } from 'drizzle-orm'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { FreshnessChip } from '@/components/ui/freshness-chip'
import { ClickableRow } from '@/components/admin/clickable-row'

export default async function AdminToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>
}) {
  const params = await searchParams
  const status = params.status ?? 'published'
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const q = params.q?.trim() ?? ''
  const pageSize = 50
  const offset = (page - 1) * pageSize

  const db = getDb()

  const whereClause = q
    ? and(eq(tools.status, status), ilike(tools.name, `%${q}%`))
    : eq(tools.status, status)

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(tools)
      .where(whereClause)
      .orderBy(desc(tools.updatedAt))
      .limit(pageSize)
      .offset(offset),

    db
      .select({ total: sql<number>`count(*)::int` })
      .from(tools)
      .where(whereClause),
  ])

  const ids = rows.map((r) => r.id)
  const programRows = ids.length
    ? await db
        .select({ toolId: toolPrograms.toolId, slug: programs.slug })
        .from(toolPrograms)
        .innerJoin(programs, eq(programs.id, toolPrograms.programId))
        .where(inArray(toolPrograms.toolId, ids))
    : []

  const progMap = new Map<string, string[]>()
  for (const r of programRows) {
    const arr = progMap.get(r.toolId) ?? []
    arr.push(r.slug)
    progMap.set(r.toolId, arr)
  }

  const STATUS_TABS = ['published', 'draft', 'suppressed']
  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="p-8 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Tools</h1>
        <Link
          href="/admin/tools/new"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
        >
          + New Tool
        </Link>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-border-subtle">
        {STATUS_TABS.map((s) => (
          <Link
            key={s}
            href={`/admin/tools?status=${s}`}
            className={`px-3 py-2 text-sm transition-colors capitalize ${
              status === s
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {/* Search + count */}
      <div className="flex items-center gap-3">
        <form method="GET" action="/admin/tools" className="flex-1 max-w-sm">
          <input type="hidden" name="status" value={status} />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name…"
            className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </form>
        <span className="text-xs text-muted">{total.toLocaleString()} {status}</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-muted text-xs">
            <tr>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Programs</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-left">Freshness</th>
              <th className="px-4 py-2 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tool) => (
              <ClickableRow key={tool.id} href={`/admin/tools/${tool.id}`} className="border-t border-border-subtle hover:bg-surface">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{tool.name}</span>
                    {tool.isOfficial && <Badge variant="official" className="text-[10px]">Official</Badge>}
                    {tool.isVendor && <Badge variant="vendor" className="text-[10px]">Vendor</Badge>}
                  </div>
                  <span className="text-xs text-muted-2">/tools/{tool.slug}</span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1 flex-wrap">
                    {(progMap.get(tool.id) ?? []).map((p) => (
                      <Badge key={p} variant="program" className="text-[10px]">{p.toUpperCase()}</Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2 text-xs text-muted">
                  {tool.toolType.replace(/_/g, ' ')}
                </td>
                <td className="px-4 py-2">
                  <FreshnessChip freshnessState={tool.freshnessState} lastActivityAt={tool.lastActivityAt} />
                </td>
                <td className="px-4 py-2 text-right text-xs text-muted">
                  {tool.popularityScore.toFixed(0)}
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex gap-2 justify-center">
          {page > 1 && (
            <Link
              href={`/admin/tools?status=${status}&page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
            >
              ← Prev
            </Link>
          )}
          <span className="px-3 py-1.5 text-xs text-muted">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/admin/tools?status=${status}&page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
              className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
