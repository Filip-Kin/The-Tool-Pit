import { getDb } from '@/lib/db'
import { toolVotes, tools } from '@the-tool-pit/db'
import { eq, desc, sql } from 'drizzle-orm'
import Link from 'next/link'

async function getVotes() {
  const db = getDb()

  const [[{ total }], recent] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(toolVotes),
    db
      .select({
        id: toolVotes.id,
        toolId: toolVotes.toolId,
        toolName: tools.name,
        toolSlug: tools.slug,
        createdAt: toolVotes.createdAt,
      })
      .from(toolVotes)
      .leftJoin(tools, eq(tools.id, toolVotes.toolId))
      .orderBy(desc(toolVotes.createdAt))
      .limit(100),
  ])

  return { total, recent }
}

export default async function AdminVotesPage() {
  const { total, recent } = await getVotes()

  return (
    <div className="p-8 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Votes</h1>
        <p className="text-sm text-muted">{total.toLocaleString()} total votes</p>
      </div>

      <p className="text-sm text-muted">Most recent 100 votes. Voter identity is anonymized.</p>

      {recent.length === 0 ? (
        <p className="text-sm text-muted">No votes recorded yet.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-muted text-xs">
              <tr>
                <th className="px-4 py-2 text-left">Tool</th>
                <th className="px-4 py-2 text-left">Voted At</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((v) => (
                <tr key={v.id} className="border-t border-border-subtle hover:bg-surface">
                  <td className="px-4 py-2">
                    {v.toolId ? (
                      <Link
                        href={`/admin/tools/${v.toolId}`}
                        className="text-sm text-primary hover:underline font-medium"
                      >
                        {v.toolName ?? v.toolId}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-2">—</span>
                    )}
                    {v.toolSlug && (
                      <span className="ml-2 text-xs text-muted-2">/tools/{v.toolSlug}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted whitespace-nowrap">
                    {new Date(v.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
