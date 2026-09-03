import { getDb } from '@/lib/db'
import { toolSources, tools } from '@the-tool-pit/db'
import { eq, desc, sql } from 'drizzle-orm'
import Link from 'next/link'
import { SourceTriggerButton } from './source-triggers'
import { assertAdmin } from '@/lib/admin/auth'
import {
  CRAWL_CONNECTORS,
  CRAWL_CONNECTOR_KEYS,
  NON_CONNECTOR_SOURCE_TYPES,
} from '@the-tool-pit/db/crawl-connectors'

/**
 * One card per source type, and the key IS the value stored in
 * tool_sources.source_type.
 *
 * It used to be a hand-written grouping under names like `github`, `tba`,
 * `submission` and `official_first`. Nothing has ever written any of those to
 * the column, so those cards read 0 for good, and the two largest real sources
 * had no card and no button at all. The screen accounted for 299 of 1229 rows.
 *
 * A connector card carries its trigger button. A non-connector card (manual, a
 * public submission) does not, because there is nothing to run.
 */
const SOURCE_DEFS = [...CRAWL_CONNECTORS, ...NON_CONNECTOR_SOURCE_TYPES]

async function getSourceStats() {
  const db = getDb()

  const counts = await db
    .select({
      sourceType: toolSources.sourceType,
      count: sql<number>`count(*)::int`,
      lastDiscovered: sql<string>`max(${toolSources.discoveredAt})::text`,
    })
    .from(toolSources)
    .groupBy(toolSources.sourceType)

  const countMap = Object.fromEntries(counts.map((r) => [r.sourceType, { count: r.count, lastDiscovered: r.lastDiscovered }]))

  const recent = await db
    .select({
      id: toolSources.id,
      toolId: toolSources.toolId,
      toolName: tools.name,
      sourceType: toolSources.sourceType,
      sourceUrl: toolSources.sourceUrl,
      discoveredAt: toolSources.discoveredAt,
    })
    .from(toolSources)
    .leftJoin(tools, eq(tools.id, toolSources.toolId))
    .orderBy(desc(toolSources.discoveredAt))
    .limit(20)

  return { countMap, recent }
}

export default async function SourcesPage() {
  await assertAdmin()
  const { countMap, recent } = await getSourceStats()

  return (
    <div className="p-4 md:p-8 flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-foreground">Sources</h1>

      {/* Source cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SOURCE_DEFS.map((src) => {
          const stats = countMap[src.key]
          return (
            <div key={src.key} className="rounded-lg border border-border bg-surface p-4 flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{src.label}</h2>
                <p className="text-xs text-muted mt-0.5">{src.description}</p>
              </div>

              <div className="flex gap-4 text-xs">
                <div>
                  <p className="text-muted">Tools</p>
                  <p className="font-bold text-foreground text-base">{stats?.count ?? 0}</p>
                </div>
                {stats?.lastDiscovered && (
                  <div>
                    <p className="text-muted">Last Discovery</p>
                    <p className="text-foreground">{new Date(stats.lastDiscovered).toLocaleDateString()}</p>
                  </div>
                )}
              </div>

              {CRAWL_CONNECTOR_KEYS.includes(src.key) && (
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border-subtle">
                  <SourceTriggerButton connector={src.key} label={`Run ${src.label}`} />
                  {!src.scheduled && (
                    // Says why there is no schedule, rather than leaving a
                    // reader to wonder whether it is broken.
                    <span className="text-xs text-muted-2">by hand only</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Recent activity */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-foreground">Recent Discoveries</h2>

        {recent.length === 0 ? (
          <p className="text-sm text-muted">No sources recorded yet.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-[36rem] w-full text-sm">
                            <thead className="bg-surface-2 text-muted text-xs">
                              <tr>
                                <th className="px-4 py-2 text-left">Tool</th>
                                <th className="px-4 py-2 text-left">Source Type</th>
                                <th className="px-4 py-2 text-left">Source URL</th>
                                <th className="px-4 py-2 text-left">Discovered</th>
                              </tr>
                            </thead>
                            <tbody>
                              {recent.map((s) => (
                                <tr key={s.id} className="border-t border-border-subtle hover:bg-surface">
                                  <td className="px-4 py-2 text-xs text-foreground">
                                    {s.toolId ? (
                                      <Link href={`/admin/tools/${s.toolId}`} className="hover:underline text-primary">
                                        {s.toolName ?? s.toolId}
                                      </Link>
                                    ) : (
                                      '-'
                                    )}
                                  </td>
                                  <td className="px-4 py-2 font-mono text-xs text-muted">{s.sourceType}</td>
                                  <td className="px-4 py-2 text-xs text-muted max-w-xs truncate">
                                    {s.sourceUrl ? (
                                      <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                        {s.sourceUrl}
                                      </a>
                                    ) : '-'}
                                  </td>
                                  <td className="px-4 py-2 text-xs text-muted whitespace-nowrap">
                                    {s.discoveredAt ? new Date(s.discoveredAt).toLocaleDateString() : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
