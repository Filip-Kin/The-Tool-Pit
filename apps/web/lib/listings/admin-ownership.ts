import { and, eq, ilike, or } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  albums,
  eventListings,
  events,
  grants,
  listingOwners,
  practiceFields,
  tools,
  type ListingEntityType,
  type ListingOwnerRole,
} from '@the-tool-pit/db'
import { listingFacts, type ListingFacts } from '@/lib/queries/listing-ownership'

/**
 * Admin listing-ownership writes and the name-search behind the "add a listing"
 * control.
 *
 * WHY THIS IS ALLOWED TO WRITE listing_owners DIRECTLY. The whole ownership
 * model (see packages/db/src/schema/listing-ownership.ts) turns on one rule: a
 * self-asserted CLAIM never writes a listing_owners row. An admin acting here is
 * not a claim. It is the "an admin decides" branch the model already names as a
 * trusted writer, the same branch adminResolveClaim in app/me/listings/actions.ts
 * uses. So these functions insert and delete the trusted row directly, with
 * verifiedVia 'admin' for the audit trail. Every caller is a server action gated
 * by isAdmin(); nothing here is reachable without that gate.
 */

/**
 * Grant a user ownership of a listing, by admin decision.
 *
 * Mirrors the grantOwnership choke point in app/me/listings/actions.ts: one
 * insert, verifiedVia carries how it was earned so the audit trail is never
 * blank. `invitedBy` is the acting admin's app-user id when there is one (an
 * Authelia/cookie admin has no app user row, so it may be null; it is an audit
 * stamp, not an FK).
 *
 * A row already exists for this (entity, user)? The admin has just picked a
 * role, so honour it: update the role and re-stamp the method rather than
 * silently doing nothing, which is what an admin changing owner↔editor expects.
 */
export async function grantOwnershipAsAdmin(
  entityType: ListingEntityType,
  entityId: string,
  userId: string,
  role: ListingOwnerRole,
  invitedBy: string | null,
): Promise<void> {
  const db = getDb()
  await db
    .insert(listingOwners)
    .values({ entityType, entityId, userId, role, verifiedVia: 'admin', invitedBy })
    .onConflictDoUpdate({
      target: [listingOwners.entityType, listingOwners.entityId, listingOwners.userId],
      set: { role, verifiedVia: 'admin', invitedBy },
    })
}

/** Revoke a user's ownership of a listing. Deletes the one trusted row. */
export async function removeOwnershipAsAdmin(
  entityType: ListingEntityType,
  entityId: string,
  userId: string,
): Promise<void> {
  const db = getDb()
  await db
    .delete(listingOwners)
    .where(
      and(
        eq(listingOwners.entityType, entityType),
        eq(listingOwners.entityId, entityId),
        eq(listingOwners.userId, userId),
      ),
    )
}

export interface ListingSearchResult {
  entityType: ListingEntityType
  entityId: string
  facts: ListingFacts
}

/**
 * Name-search listings across all five entity tables, for the admin "add a
 * listing" picker.
 *
 * One query per table on its own name column: tools, practice fields, off-season
 * events and grants carry `name`; an album is identified by its `title` OR the
 * event it belongs to, so it is searched on both through the same join the
 * display resolver uses. Ids are then resolved to a title/subtitle/href through
 * listingFacts, the single door onto the display resolvers, so a search result
 * reads exactly the way the owned-listing rows do.
 */
export async function searchListingsByName(
  query: string,
  limitPerType = 6,
): Promise<ListingSearchResult[]> {
  const q = query.trim()
  // Two characters is the floor: a one-letter ilike matches most of the table
  // and tells an admin nothing.
  if (q.length < 2) return []
  const like = `%${q}%`
  const db = getDb()

  const [toolRows, albumRows, fieldRows, eventRows, grantRows] = await Promise.all([
    db.select({ id: tools.id }).from(tools).where(ilike(tools.name, like)).limit(limitPerType),
    db
      .select({ id: albums.id })
      .from(albums)
      .innerJoin(events, eq(events.id, albums.eventId))
      .where(or(ilike(albums.title, like), ilike(events.name, like)))
      .limit(limitPerType),
    db
      .select({ id: practiceFields.id })
      .from(practiceFields)
      .where(ilike(practiceFields.name, like))
      .limit(limitPerType),
    db
      .select({ id: eventListings.id })
      .from(eventListings)
      .where(ilike(eventListings.name, like))
      .limit(limitPerType),
    db.select({ id: grants.id }).from(grants).where(ilike(grants.name, like)).limit(limitPerType),
  ])

  const pairs: Array<[ListingEntityType, string]> = [
    ...toolRows.map((r) => ['tool', r.id] as [ListingEntityType, string]),
    ...albumRows.map((r) => ['album', r.id] as [ListingEntityType, string]),
    ...fieldRows.map((r) => ['field', r.id] as [ListingEntityType, string]),
    ...eventRows.map((r) => ['event', r.id] as [ListingEntityType, string]),
    ...grantRows.map((r) => ['grant', r.id] as [ListingEntityType, string]),
  ]

  const resolved = await Promise.all(
    pairs.map(async ([entityType, entityId]) => {
      const facts = await listingFacts(entityType, entityId)
      return facts ? { entityType, entityId, facts } : null
    }),
  )
  return resolved.filter((r): r is ListingSearchResult => r !== null)
}
