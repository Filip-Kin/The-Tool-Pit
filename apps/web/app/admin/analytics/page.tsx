import { getDb } from '@/lib/db'
import { searchEvents, toolClickEvents, tools } from '@the-tool-pit/db'
import { sql, gte, eq } from 'drizzle-orm'

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

    // Top clicked tools (joined with tool name)
    db
      .select({
        toolId: toolClickEvents.toolId,
        toolName: tools.name,
        count: sql<number>`count(*)::int`,
      })
      .from(toolClickEvents)
      .leftJoin(tools, eq(tools.id, toolClickEvents.toolId))
      .where(gte(toolClickEvents.createdAt, sevenDaysAgo))
      .groupBy(toolClickEvents.toolId, tools.name)
      .orderBy(sql`count(*) desc`)
      .limit(20),
  ])

  return { topQueries, zeroResultQueries, topClicked }
}

export default async function AdminAnalyticsPage() {
  const data = await getAnalytics()

  return (
    <div className="p-8 flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-foreground">Analytics (last 7 days)</h1>

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

        {/* Top clicked tools */}
        <AnalyticsTable
          title="Top Clicked Tools"
          description="Tools with the most link clicks in the last 7 days"
          headers={['Tool', 'Clicks']}
          rows={data.topClicked.map((r) => [r.toolName ?? r.toolId, r.count])}
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
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
      </div>
      <div className={`rounded-lg border overflow-hidden ${highlightEmpty ? 'border-official/30' : 'border-border'}`}>
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-muted text-xs">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-3 py-2 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="px-3 py-4 text-center text-xs text-muted">
                  No data
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="border-t border-border-subtle hover:bg-surface">
                  {row.map((cell, j) => (
                    <td key={j} className={`px-3 py-2 ${j === 0 ? 'font-mono text-xs text-foreground' : 'text-xs text-muted'}`}>
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
