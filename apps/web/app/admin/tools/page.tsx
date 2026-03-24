import { getDb } from '@/lib/db'
import { tools, toolPrograms, programs } from '@the-tool-pit/db'
import { eq, sql, desc, inArray } from 'drizzle-orm'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { FreshnessChip } from '@/components/ui/freshness-chip'

export default async function AdminToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const params = await searchParams
  const status = params.status ?? 'published'
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const pageSize = 50
  const offset = (page - 1) * pageSize

  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .where(eq(tools.status, status))
    .orderBy(desc(tools.updatedAt))
    .limit(pageSize)
    .offset(offset)

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
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tool) => (
              <tr key={tool.id} className="border-t border-border-subtle hover:bg-surface">
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
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/tools/${tool.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
