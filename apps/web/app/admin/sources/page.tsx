import { getDb } from '@/lib/db'
import { toolSources, tools } from '@the-tool-pit/db'
import { eq, desc } from 'drizzle-orm'
import Link from 'next/link'

async function getSources() {
  const db = getDb()
  return db
    .select({
      id: toolSources.id,
      toolId: toolSources.toolId,
      toolName: tools.name,
      sourceType: toolSources.sourceType,
      sourceUrl: toolSources.sourceUrl,
      discoveredAt: toolSources.discoveredAt,
      notes: toolSources.notes,
    })
    .from(toolSources)
    .leftJoin(tools, eq(tools.id, toolSources.toolId))
    .orderBy(desc(toolSources.discoveredAt))
    .limit(100)
}

export default async function SourcesPage() {
  const sources = await getSources()

  return (
    <div className="p-8 flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-foreground">Tool Sources</h1>
      <p className="text-sm text-muted">Evidence records linking tools to where they were discovered.</p>

      {sources.length === 0 ? (
        <p className="text-sm text-muted">No sources recorded yet.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted text-xs">
              <tr>
                <th className="px-4 py-2 text-left">Tool</th>
                <th className="px-4 py-2 text-left">Source Type</th>
                <th className="px-4 py-2 text-left">Source URL</th>
                <th className="px-4 py-2 text-left">Discovered</th>
                <th className="px-4 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-t border-border-subtle hover:bg-surface">
                  <td className="px-4 py-2 text-xs text-foreground">
                    {s.toolId ? (
                      <Link
                        href={`/admin/tools/${s.toolId}`}
                        className="hover:underline text-primary"
                      >
                        {s.toolName ?? s.toolId}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{s.sourceType}</td>
                  <td className="px-4 py-2 text-xs text-muted max-w-xs truncate">
                    {s.sourceUrl ? (
                      <a
                        href={s.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {s.sourceUrl}
                      </a>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted whitespace-nowrap">
                    {s.discoveredAt ? new Date(s.discoveredAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted max-w-xs truncate">{s.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
