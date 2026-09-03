import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { users } from '@the-tool-pit/db'
import { assertAdmin } from '@/lib/admin/auth'
import { listOwnedListings } from '@/lib/queries/listing-ownership'
import { formatDate, formatDateTime } from '@/lib/format/date'
import { Badge } from '@/components/ui/badge'
import { OwnershipPanel } from './ownership-panel'

/**
 * One account, and the listings it owns. The admin can revoke any ownership row
 * or grant a new one from here; both go through the trusted-writer server
 * actions in ../actions.ts.
 */

export const dynamic = 'force-dynamic'

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  await assertAdmin()
  const { id } = await params

  const db = getDb()
  const [user] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      emailVerified: users.emailVerified,
      isAdmin: users.isAdmin,
      githubLogin: users.githubLogin,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
      blockedReason: users.blockedReason,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)

  if (!user) notFound()

  const owned = await listOwnedListings(user.id)
  // Only what the client panel binds to; keep it serialisable.
  const ownedForClient = owned.map((o) => ({
    entityType: o.entityType,
    entityId: o.entityId,
    role: o.role,
    title: o.facts.title,
    subtitle: o.facts.subtitle,
    href: o.facts.href,
  }))

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8">
      <div>
        <Link href="/admin/users" className="text-xs text-muted hover:text-foreground">
          ← All users
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">
            {user.displayName || 'No name'}
          </h1>
          {user.isAdmin && <Badge variant="program">Admin</Badge>}
          {user.blockedReason && <Badge variant="vendor">Blocked</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted">{user.email || 'No email'}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Joined</dt>
          <dd className="text-foreground">{formatDate(user.createdAt) || '-'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Last seen</dt>
          <dd className="text-foreground">{formatDateTime(user.lastSeenAt) || '-'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">GitHub</dt>
          <dd className="text-foreground">{user.githubLogin ? `@${user.githubLogin}` : '-'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Email verified</dt>
          <dd className="text-foreground">{user.emailVerified ? 'Yes' : 'No'}</dd>
        </div>
        {user.blockedReason && (
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-xs text-muted">Blocked reason</dt>
            <dd className="text-foreground">{user.blockedReason}</dd>
          </div>
        )}
      </dl>

      <OwnershipPanel userId={user.id} owned={ownedForClient} />
    </div>
  )
}
