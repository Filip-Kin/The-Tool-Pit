import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { eventListings, users, EVENT_LISTING_STATUSES } from '@the-tool-pit/db'
import type { EventListingStatus } from '@the-tool-pit/db'
import { EventAdminRow } from './event-admin-row'

export const dynamic = 'force-dynamic'

/**
 * 'all' is not a status, it is the absence of a filter. It is here because the
 * sidebar needs one link per vertical that means "everything we hold", and
 * three status tabs cannot answer "is this event already listed".
 */
const TABS = [...EVENT_LISTING_STATUSES, 'all'] as const
type Tab = EventListingStatus | 'all'

export default async function EventListingsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await assertAdmin()
  const { status } = await searchParams
  const active: Tab = (TABS as readonly string[]).includes(status ?? '') ? (status as Tab) : 'pending'

  const db = getDb()
  // Left join the account: sign-in is optional on the public form, so most rows
  // have no user and must still come back.
  const rows = await db
    .select({
      listing: eventListings,
      accountId: users.id,
      accountName: users.displayName,
      accountEmail: users.email,
    })
    .from(eventListings)
    .leftJoin(users, eq(eventListings.submittedByUserId, users.id))
    .where(active === 'all' ? undefined : eq(eventListings.status, active))
    .orderBy(desc(eventListings.createdAt))

  const all = await db.select({ status: eventListings.status }).from(eventListings)
  const counts: Record<string, number> = {}
  for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-semibold text-foreground">Off-Season Events</h1>
      <p className="mt-1 text-sm text-muted">Review submitted events, place their pin, and publish to the map.</p>

      <div className="mt-4 flex gap-1 border-b border-border-subtle">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/admin/event-listings?status=${t}`}
            className={
              'rounded-t-md px-3 py-2 text-sm capitalize ' +
              (t === active ? 'border-b-2 border-primary font-medium text-foreground' : 'text-muted hover:text-foreground')
            }
          >
            {t}{' '}
            {t === 'all' ? (
              <span className="text-muted-2">({all.length})</span>
            ) : counts[t] ? (
              <span className="text-muted-2">({counts[t]})</span>
            ) : null}
          </Link>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {rows.length === 0 && <p className="text-sm text-muted-2">Nothing here.</p>}
        {rows.map((r) => (
          <EventAdminRow
            key={r.listing.id}
            listing={r.listing}
            account={r.accountId ? { id: r.accountId, displayName: r.accountName, email: r.accountEmail } : null}
          />
        ))}
      </div>
    </div>
  )
}
