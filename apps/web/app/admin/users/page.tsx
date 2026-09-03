import { and, desc, ilike, inArray, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { listingOwners, users } from '@the-tool-pit/db'
import { assertAdmin } from '@/lib/admin/auth'
import { Pager } from '@/components/admin/pager'
import { ClickableRow } from '@/components/admin/clickable-row'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format/date'

/**
 * Accounts, one clean row each: who they are, whether they are an admin, the
 * GitHub login if they linked one, when they joined and were last seen, and how
 * many listings they own. The row links to the per-user page where an admin
 * manages that ownership.
 */

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  await assertAdmin()
  const params = await searchParams
  const q = params.q?.trim() ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const db = getDb()

  const where = q ? or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`)) : undefined

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        isAdmin: users.isAdmin,
        githubLogin: users.githubLogin,
        createdAt: users.createdAt,
        lastSeenAt: users.lastSeenAt,
        blockedReason: users.blockedReason,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),

    db.select({ total: sql<number>`count(*)::int` }).from(users).where(where),
  ])

  // Owned-listing count for just the users on this page, one grouped query.
  const ids = rows.map((r) => r.id)
  const countRows = ids.length
    ? await db
        .select({ userId: listingOwners.userId, count: sql<number>`count(*)::int` })
        .from(listingOwners)
        .where(inArray(listingOwners.userId, ids))
        .groupBy(listingOwners.userId)
    : []
  const ownedCount = new Map(countRows.map((r) => [r.userId, r.count]))

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="mt-1 text-sm text-muted">
          Accounts across every vertical, and the listings each one owns.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <form method="GET" action="/admin/users" className="max-w-sm flex-1">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name or email…"
            className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </form>
        <span className="text-xs text-muted">{total.toLocaleString()} users</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-4 py-2 text-left">User</th>
                <th className="px-4 py-2 text-left">GitHub</th>
                <th className="px-4 py-2 text-left">Joined</th>
                <th className="px-4 py-2 text-left">Last seen</th>
                <th className="px-4 py-2 text-right">Listings</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted">
                    {q ? 'No users match that search.' : 'No users yet.'}
                  </td>
                </tr>
              ) : (
                rows.map((u) => (
                  <ClickableRow
                    key={u.id}
                    href={`/admin/users/${u.id}`}
                    className="border-t border-border-subtle hover:bg-surface"
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {u.displayName || 'No name'}
                        </span>
                        {u.isAdmin && (
                          <Badge variant="program" className="text-[10px]">
                            Admin
                          </Badge>
                        )}
                        {u.blockedReason && (
                          <Badge variant="vendor" className="text-[10px]">
                            Blocked
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-2">{u.email || 'No email'}</span>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">
                      {u.githubLogin ? `@${u.githubLogin}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">{formatDate(u.createdAt) || '—'}</td>
                    <td className="px-4 py-2 text-xs text-muted">{formatDate(u.lastSeenAt) || '—'}</td>
                    <td className="px-4 py-2 text-right text-xs text-muted tabular-nums">
                      {ownedCount.get(u.id) ?? 0}
                    </td>
                  </ClickableRow>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pager
        page={page}
        totalPages={totalPages}
        href={(n) => `/admin/users?page=${n}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
      />
    </div>
  )
}
