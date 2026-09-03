import Link from 'next/link'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { eventListings, eventRosterSnapshots, listingOwners, users, coerceOwnerRole, EVENT_LISTING_STATUSES } from '@the-tool-pit/db'
import type { EventListingStatus, RosterTeam } from '@the-tool-pit/db'
import { EventAdminRow, type EventOwner } from './event-admin-row'

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

  // The newest UNAPPROVED scraped roster per listing, so the row can offer a
  // one-press approve. A scraped snapshot lands 'pending' and its count is held
  // back from the public card until a human approves it here.
  const listingIds = rows.map((r) => r.listing.id)
  const pendingSnaps = listingIds.length
    ? await db
        .select({
          id: eventRosterSnapshots.id,
          eventListingId: eventRosterSnapshots.eventListingId,
          teams: eventRosterSnapshots.teams,
          fetchedAt: eventRosterSnapshots.fetchedAt,
        })
        .from(eventRosterSnapshots)
        .where(
          and(eq(eventRosterSnapshots.status, 'pending'), inArray(eventRosterSnapshots.eventListingId, listingIds)),
        )
        .orderBy(desc(eventRosterSnapshots.fetchedAt))
    : []
  const pendingRosterByListing = new Map<string, { snapshotId: string; teamCount: number }>()
  for (const s of pendingSnaps) {
    // Ordered newest-first, so the first one seen for a listing is the one to offer.
    if (pendingRosterByListing.has(s.eventListingId)) continue
    const teams = (s.teams ?? []) as RosterTeam[]
    pendingRosterByListing.set(s.eventListingId, {
      snapshotId: s.id,
      teamCount: teams.filter((t) => !t.waitlisted).length,
    })
  }

  // Who OWNS each listing now, which is a different fact from who first
  // submitted it: a scraped event has an anonymous submitter and can still be
  // claimed and owned by the team that runs it. One batched read, keyed by
  // listing, so the row can show the owners without an N+1 across the page.
  const ownerRows = listingIds.length
    ? await db
        .select({
          entityId: listingOwners.entityId,
          role: listingOwners.role,
          displayName: users.displayName,
          email: users.email,
        })
        .from(listingOwners)
        .innerJoin(users, eq(users.id, listingOwners.userId))
        .where(and(eq(listingOwners.entityType, 'event'), inArray(listingOwners.entityId, listingIds)))
        .orderBy(desc(listingOwners.createdAt))
    : []
  const ownersByListing = new Map<string, EventOwner[]>()
  for (const o of ownerRows) {
    const list = ownersByListing.get(o.entityId) ?? []
    list.push({ role: coerceOwnerRole(o.role), displayName: o.displayName, email: o.email })
    ownersByListing.set(o.entityId, list)
  }

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-semibold text-foreground">Off-Season Events</h1>
      <p className="mt-1 text-sm text-muted">Review submitted events, place their pin, and publish to the map.</p>

      <div className="mt-4 flex flex-wrap gap-x-1 border-b border-border-subtle">
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
        {/* id: the Discord notice links straight to the row it is about. */}
        {rows.map((r) => (
          <div key={r.listing.id} id={`event-${r.listing.id}`} className="scroll-mt-6">
            <EventAdminRow
              listing={r.listing}
              account={r.accountId ? { id: r.accountId, displayName: r.accountName, email: r.accountEmail } : null}
              owners={ownersByListing.get(r.listing.id) ?? []}
              pendingRoster={pendingRosterByListing.get(r.listing.id) ?? null}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
