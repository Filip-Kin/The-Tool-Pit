import { getDb } from '@/lib/db'
import { searchEvents, toolClickEvents } from '@the-tool-pit/db'
import { sql, desc, gte } from 'drizzle-orm'

async function getAnalytics() {
  const db = getDb()
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

  const [topQueries, zeroResultQueries, topClicked] = await Promise.all([
    // Top search queries in last 7 days
    db
      .select({
        query: searchEvents.query,
        count: sql<number>`count(*)::int`,
        avgResults: sql<number>`avg(${searchEvents.resultCount})::int`,
      })
      .from(searchEvents)
      .where(gte(searchEvents.createdAt, sevenDaysAgo))
      .groupBy(searchEvents.query)
      .orderBy(sql`count(*) desc`)
      .limit(20),

    // Queries with zero results
    db
      .select({
        query: searchEvents.query,
        count: sql<number>`count(*)::int`,
      })
      .from(searchEvents)
      .where(sql`${searchEvents.resultCount} = 0 and ${searchEvents.createdAt} >= ${sevenDaysAgo}`)
      .groupBy(searchEvents.query)
      .orderBy(sql`count(*) desc`)
      .limit(20),

    // Top clicked tools
    db
      .select({
        toolId: toolClickEvents.toolId,
        count: sql<number>`count(*)::int`,
      })
      .from(toolClickEvents)
      .where(gte(toolClickEvents.createdAt, sevenDaysAgo))
      .groupBy(toolClickEvents.toolId)
      .orderBy(sql`count(*) desc`)
      .limit(20),
  ])

  return { topQueries, zeroResultQueries, topClicked }
}

export default async function AdminAnalyticsPage() {
  const data = await getAnalytics()

  return (
    <div className="p-8 flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Analytics (last 7 days)</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top queries */}
        <AnalyticsTable
          title="Top Search Queries"
          headers={['Query', 'Searches', 'Avg Results']}
          rows={data.topQueries.map((r) => [r.query, r.count, r.avgResults])}
        />

        {/* Zero result queries */}
        <AnalyticsTable
          title="Zero-Result Searches"
          description="Queries that returned no tools — opportunities for new content"
          headers={['Query', 'Count']}
          rows={data.zeroResultQueries.map((r) => [r.query, r.count])}
          highlightEmpty
        />
      </div>
    </div>
  )
}

function AnalyticsTable({
  title,
  description,
  headers,
  rows,
  highlightEmpty,
}: {
  title: string
  description?: string
  headers: string[]
  rows: (string | number)[][]
  highlightEmpty?: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-foreground)]">{title}</h2>
        {description && <p className="text-xs text-[var(--color-muted)] mt-0.5">{description}</p>}
      </div>
      <div className={`rounded-lg border overflow-hidden ${highlightEmpty ? 'border-[var(--color-official)]/30' : 'border-[var(--color-border)]'}`}>
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface-2)] text-[var(--color-muted)] text-xs">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-3 py-2 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="px-3 py-4 text-center text-xs text-[var(--color-muted)]">
                  No data
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface)]">
                  {row.map((cell, j) => (
                    <td key={j} className={`px-3 py-2 ${j === 0 ? 'font-mono text-xs text-[var(--color-foreground)]' : 'text-xs text-[var(--color-muted)]'}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
