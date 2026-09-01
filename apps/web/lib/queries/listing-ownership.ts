import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  albums,
  events,
  listingClaims,
  listingOwners,
  practiceFields,
  toolLinks,
  tools,
  users,
  LISTING_ENTITY_TYPES,
  LISTING_WRITE_ROLES,
  type ClaimStatus,
  type ListingEntityType,
  type ListingOwnerRole,
} from '@the-tool-pit/db'
import { displayEventName } from './albums'

/**
 * Listing ownership reads.
 *
 * The privacy rule from app/me/team/profile/queries.ts applies here too, in its
 * write-permission form: a claim to own a listing is self-asserted and proves
 * nothing, so nothing in this file resolves ownership from a claim. Every read
 * that decides "these are your listings" or "may this user edit" goes through a
 * listing_owners row, which is only ever written after a verification passes or
 * an admin decides. listing_claims is read only to show a user the state of
 * their own pending requests, never to grant access.
 *
 * Nothing here is exported to a client component. Pages load values server-side
 * and pass them down as props.
 */

/** Narrowing guard for the untyped `entity_type` text column and for route input. */
export function isListingEntityType(value: unknown): value is ListingEntityType {
  return typeof value === 'string' && (LISTING_ENTITY_TYPES as readonly string[]).includes(value)
}

// #region display resolution
//
// Same fan-out shape as lib/queries/favorites.ts: one query per entity TYPE
// present, never one per listing. Each resolver returns only what a listing
// card needs, keyed by target id. A target that no longer exists is simply
// absent from the map and dropped by the caller.

/** What a listing card shows, resolved per entity type. */
export interface ListingFacts {
  title: string
  subtitle: string | null
  /** The public page for the listing, root-relative (all verticals on one host). */
  href: string
}

type Resolved = Map<string, ListingFacts>

async function resolveTools(ids: string[]): Promise<Resolved> {
  const db = getDb()
  const rows = await db
    .select({ id: tools.id, slug: tools.slug, name: tools.name, summary: tools.summary, status: tools.status })
    .from(tools)
    .where(inArray(tools.id, ids))
  const out: Resolved = new Map()
  for (const r of rows) {
    // Owners see their listing here even while it is a draft or suppressed, so
    // an owner is never told "you own nothing" about a listing that exists but
    // is not currently public. The subtitle carries the status when not live.
    const status = r.status === 'published' ? null : `(${r.status})`
    out.set(r.id, {
      title: r.name,
      subtitle: [r.summary, status].filter(Boolean).join(' ') || null,
      href: `/tools/${r.slug}`,
    })
  }
  return out
}

async function resolveAlbums(ids: string[]): Promise<Resolved> {
  const db = getDb()
  const rows = await db
    .select({
      id: albums.id,
      url: albums.url,
      title: albums.title,
      photographer: albums.photographer,
      status: albums.status,
      eventName: events.name,
      eventType: events.eventType,
      eventYear: events.year,
    })
    .from(albums)
    .innerJoin(events, eq(events.id, albums.eventId))
    .where(inArray(albums.id, ids))
  const out: Resolved = new Map()
  for (const r of rows) {
    const eventLabel = displayEventName({ name: r.eventName, eventType: r.eventType, year: r.eventYear })
    const status = r.status === 'published' ? null : `(${r.status})`
    out.set(r.id, {
      title: r.title || eventLabel,
      subtitle: [r.photographer ? `${r.photographer} · ${eventLabel}` : eventLabel, status]
        .filter(Boolean)
        .join(' '),
      // Albums have no detail page in this app; link out to the gallery itself.
      href: r.url,
    })
  }
  return out
}

async function resolveFields(ids: string[]): Promise<Resolved> {
  const db = getDb()
  const rows = await db
    .select({
      id: practiceFields.id,
      name: practiceFields.name,
      teamNumber: practiceFields.teamNumber,
      teamName: practiceFields.teamName,
      city: practiceFields.city,
      region: practiceFields.region,
      status: practiceFields.status,
    })
    .from(practiceFields)
    .where(inArray(practiceFields.id, ids))
  const out: Resolved = new Map()
  for (const r of rows) {
    const owner = r.teamNumber ? `Team ${r.teamNumber}` : r.teamName
    const place = [r.city, r.region].filter(Boolean).join(', ')
    const status = r.status === 'published' ? null : `(${r.status})`
    out.set(r.id, {
      title: r.name,
      subtitle: [owner, place, status].filter(Boolean).join(' · ') || null,
      href: `/fields/${r.id}`,
    })
  }
  return out
}

const RESOLVERS: Record<ListingEntityType, (ids: string[]) => Promise<Resolved>> = {
  tool: resolveTools,
  album: resolveAlbums,
  field: resolveFields,
}

/**
 * Facts for ONE listing, or null when it no longer exists.
 *
 * The single-id door onto the resolvers above, for callers that already know
 * which listing they mean. The approval emails use it so a claim decision can
 * name the listing rather than saying "your claim was approved".
 */
export async function listingFacts(
  entityType: ListingEntityType,
  entityId: string,
): Promise<ListingFacts | null> {
  const resolved = await RESOLVERS[entityType]([entityId])
  return resolved.get(entityId) ?? null
}

// #endregion

// #region owned listings

export interface OwnedListing {
  entityType: ListingEntityType
  entityId: string
  role: ListingOwnerRole
  canEdit: boolean
  facts: ListingFacts
}

/**
 * Every listing this user owns, grouped by type, resolved for display.
 *
 * Driven entirely off listing_owners. A claim that has not been verified has no
 * row here and so never appears, which is the whole safety property: an
 * unverified claim can neither read nor edit.
 */
export async function listOwnedListings(userId: string): Promise<OwnedListing[]> {
  const db = getDb()
  const rows = await db
    .select({
      entityType: listingOwners.entityType,
      entityId: listingOwners.entityId,
      role: listingOwners.role,
      createdAt: listingOwners.createdAt,
    })
    .from(listingOwners)
    .where(eq(listingOwners.userId, userId))
    .orderBy(desc(listingOwners.createdAt))

  if (rows.length === 0) return []

  const idsByType = new Map<ListingEntityType, string[]>()
  for (const row of rows) {
    if (!isListingEntityType(row.entityType)) continue
    const list = idsByType.get(row.entityType)
    if (list) list.push(row.entityId)
    else idsByType.set(row.entityType, [row.entityId])
  }

  const resolvedPerType = await Promise.all(
    [...idsByType.entries()].map(
      async ([type, ids]) => [type, await RESOLVERS[type]([...new Set(ids)])] as const,
    ),
  )
  const byType = new Map<ListingEntityType, Resolved>(resolvedPerType)

  const out: OwnedListing[] = []
  for (const row of rows) {
    if (!isListingEntityType(row.entityType)) continue
    const facts = byType.get(row.entityType)?.get(row.entityId)
    if (!facts) continue // target deleted
    const role = row.role as ListingOwnerRole
    out.push({
      entityType: row.entityType,
      entityId: row.entityId,
      role,
      canEdit: LISTING_WRITE_ROLES.includes(role),
      facts,
    })
  }
  return out
}

/** This user's ownership row for one listing, or null. The write-path gate. */
export async function getOwnerRole(
  userId: string,
  entityType: ListingEntityType,
  entityId: string,
): Promise<ListingOwnerRole | null> {
  const db = getDb()
  const [row] = await db
    .select({ role: listingOwners.role })
    .from(listingOwners)
    .where(
      and(
        eq(listingOwners.userId, userId),
        eq(listingOwners.entityType, entityType),
        eq(listingOwners.entityId, entityId),
      ),
    )
    .limit(1)
  return row ? (row.role as ListingOwnerRole) : null
}

/** True when this user may write to this listing. Used by every edit action. */
export async function canEditListing(
  userId: string,
  entityType: ListingEntityType,
  entityId: string,
): Promise<boolean> {
  const role = await getOwnerRole(userId, entityType, entityId)
  return role !== null && LISTING_WRITE_ROLES.includes(role)
}

/**
 * How many owners a listing already has. Zero means the claim path can try to
 * verify and grant ownership; non-zero means a fresh claim must go to review or
 * an invite, never an auto-grant, so a second person cannot take it over.
 */
export async function countOwners(entityType: ListingEntityType, entityId: string): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ id: listingOwners.id })
    .from(listingOwners)
    .where(and(eq(listingOwners.entityType, entityType), eq(listingOwners.entityId, entityId)))
  return rows.length
}

// #endregion

// #region claims

export interface UserClaim {
  id: string
  entityType: ListingEntityType
  entityId: string
  method: string
  status: ClaimStatus
  createdAt: Date
  facts: ListingFacts | null
  /** repo_file only: the token the user must commit and the repo to commit it to. */
  verifyToken: string | null
  repoUrl: string | null
}

/** The file a repo owner adds to prove control. Mirrors the value in actions.ts. */
export const VERIFY_FILENAME = '.frc-tools-verify'

/** This user's own claims and their state, newest first. Read-only surface. */
export async function listClaimsForUser(userId: string): Promise<UserClaim[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: listingClaims.id,
      entityType: listingClaims.entityType,
      entityId: listingClaims.entityId,
      method: listingClaims.method,
      status: listingClaims.status,
      createdAt: listingClaims.createdAt,
      evidence: listingClaims.evidence,
    })
    .from(listingClaims)
    .where(eq(listingClaims.userId, userId))
    .orderBy(desc(listingClaims.createdAt))

  if (rows.length === 0) return []

  const idsByType = new Map<ListingEntityType, string[]>()
  for (const row of rows) {
    if (!isListingEntityType(row.entityType)) continue
    const list = idsByType.get(row.entityType)
    if (list) list.push(row.entityId)
    else idsByType.set(row.entityType, [row.entityId])
  }
  const resolvedPerType = await Promise.all(
    [...idsByType.entries()].map(
      async ([type, ids]) => [type, await RESOLVERS[type]([...new Set(ids)])] as const,
    ),
  )
  const byType = new Map<ListingEntityType, Resolved>(resolvedPerType)

  return rows.filter((r) => isListingEntityType(r.entityType)).map((r) => {
    const type = r.entityType as ListingEntityType
    const isRepo = r.method === 'repo_file' && r.status === 'pending'
    return {
      id: r.id,
      entityType: type,
      entityId: r.entityId,
      method: r.method,
      status: r.status as ClaimStatus,
      createdAt: r.createdAt,
      facts: byType.get(type)?.get(r.entityId) ?? null,
      verifyToken: isRepo ? (r.evidence?.token ?? null) : null,
      repoUrl: isRepo ? (r.evidence?.repoUrl ?? null) : null,
    }
  })
}

// #endregion

// #region claimable listing lookup
//
// The claim flow needs to resolve an arbitrary (type, id) the user pastes or
// deep-links, decide whether it exists, whether it already has an owner, and
// which verification method applies. These helpers are the only place that
// reads a listing the user does not (yet) own, so they return only public,
// non-sensitive columns.

/** A GitHub repo URL for a tool, from its links or nothing. Drives repo_file proof. */
export async function findToolRepoUrl(toolId: string): Promise<string | null> {
  const db = getDb()
  const rows = await db
    .select({ linkType: toolLinks.linkType, url: toolLinks.url })
    .from(toolLinks)
    .where(eq(toolLinks.toolId, toolId))
  // Prefer an explicit github/source link; fall back to any github.com url.
  const preferred = rows.find((r) => r.linkType === 'github' || r.linkType === 'source')
  if (preferred && /github\.com/i.test(preferred.url)) return preferred.url
  const anyGithub = rows.find((r) => /github\.com/i.test(r.url))
  return anyGithub?.url ?? null
}

export interface ClaimableListing {
  entityType: ListingEntityType
  entityId: string
  facts: ListingFacts
  /** Owners already exist; a fresh claim cannot auto-grant. */
  alreadyOwned: boolean
  /** For tools: a repo we can verify against, when there is one. */
  repoUrl: string | null
  /**
   * True when the signed-in user is the one who submitted this field. Only
   * fields carry a submitter id; the strongest possible proof, so it short-
   * circuits to instant ownership in the claim action.
   */
  isSelfSubmitted: boolean
  /**
   * The user's own open claim on this listing, when there is one.
   *
   * Without this the claim page rebuilt its form on every load, so a claim you
   * had already sent looked unsent and the obvious move was to send it again.
   * The action refuses a second one, but the UI has to say so before the click,
   * not after it.
   */
  existingClaim: { status: string; method: string; token: string | null } | null
}

/**
 * Resolve a listing the user wants to claim, with everything the claim action
 * needs to pick a verification path. Returns null when the id does not resolve
 * to a real listing of that type, so a guessed id reveals nothing.
 */
export async function resolveClaimable(
  userId: string,
  entityType: ListingEntityType,
  entityId: string,
): Promise<ClaimableListing | null> {
  const facts = (await RESOLVERS[entityType]([entityId])).get(entityId)
  if (!facts) return null

  const alreadyOwned = (await countOwners(entityType, entityId)) > 0

  let repoUrl: string | null = null
  let isSelfSubmitted = false

  if (entityType === 'tool') {
    repoUrl = await findToolRepoUrl(entityId)
  } else if (entityType === 'field') {
    const db = getDb()
    const [row] = await db
      .select({ submittedByUserId: practiceFields.submittedByUserId })
      .from(practiceFields)
      .where(eq(practiceFields.id, entityId))
      .limit(1)
    isSelfSubmitted = row?.submittedByUserId === userId
  }

  const db = getDb()
  const [open] = await db
    .select({ status: listingClaims.status, method: listingClaims.method, evidence: listingClaims.evidence })
    .from(listingClaims)
    .where(
      and(
        eq(listingClaims.userId, userId),
        eq(listingClaims.entityType, entityType),
        eq(listingClaims.entityId, entityId),
        eq(listingClaims.status, 'pending'),
      ),
    )
    .limit(1)

  const existingClaim = open
    ? { status: open.status, method: open.method, token: open.evidence?.token ?? null }
    : null

  return { entityType, entityId, facts, alreadyOwned, repoUrl, isSelfSubmitted, existingClaim }
}

// #endregion

// #region load one listing for the owner edit form
//
// Returns the editable columns for the type. Safe to read the whole row here
// because every caller has already proven canEditListing; the returned shape
// still names only the columns the owner form actually writes, so a widening of
// the select cannot leak a private column into a form.

export interface EditableToolValues {
  name: string
  summary: string | null
  description: string | null
  vendorName: string | null
  toolType: string
}
export interface EditableAlbumValues {
  title: string | null
  photographer: string | null
  description: string | null
  dateText: string | null
}
export interface EditableFieldValues {
  name: string
  hours: string | null
  contactInfo: string | null
  contactUrl: string | null
  website: string | null
  notes: string | null
}

export type EditableListing =
  | { entityType: 'tool'; facts: ListingFacts; values: EditableToolValues }
  | { entityType: 'album'; facts: ListingFacts; values: EditableAlbumValues }
  | { entityType: 'field'; facts: ListingFacts; values: EditableFieldValues }

export async function loadListingForEdit(
  entityType: ListingEntityType,
  entityId: string,
): Promise<EditableListing | null> {
  const db = getDb()
  const facts = (await RESOLVERS[entityType]([entityId])).get(entityId)
  if (!facts) return null

  if (entityType === 'tool') {
    const [row] = await db
      .select({
        name: tools.name,
        summary: tools.summary,
        description: tools.description,
        vendorName: tools.vendorName,
        toolType: tools.toolType,
      })
      .from(tools)
      .where(eq(tools.id, entityId))
      .limit(1)
    if (!row) return null
    return { entityType, facts, values: row }
  }
  if (entityType === 'album') {
    const [row] = await db
      .select({
        title: albums.title,
        photographer: albums.photographer,
        description: albums.description,
        dateText: albums.dateText,
      })
      .from(albums)
      .where(eq(albums.id, entityId))
      .limit(1)
    if (!row) return null
    return { entityType, facts, values: row }
  }
  const [row] = await db
    .select({
      name: practiceFields.name,
      hours: practiceFields.hours,
      contactInfo: practiceFields.contactInfo,
      contactUrl: practiceFields.contactUrl,
      website: practiceFields.website,
      notes: practiceFields.notes,
    })
    .from(practiceFields)
    .where(eq(practiceFields.id, entityId))
    .limit(1)
  if (!row) return null
  return { entityType, facts, values: row }
}

// #endregion

// #region admin claim queue
//
// Every pending claim across all users, for an admin to resolve. Reads the
// claimant WITH the claim so a reviewer can see who is asking, and the current
// owners so a dispute is legible ("this tool is already owned by X").

export interface AdminClaim {
  id: string
  entityType: ListingEntityType
  entityId: string
  method: string
  createdAt: Date
  claimantName: string | null
  claimantEmail: string | null
  note: string | null
  facts: ListingFacts | null
  currentOwners: OwnerRow[]
}

export async function listPendingClaimsForAdmin(): Promise<AdminClaim[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: listingClaims.id,
      entityType: listingClaims.entityType,
      entityId: listingClaims.entityId,
      method: listingClaims.method,
      evidence: listingClaims.evidence,
      createdAt: listingClaims.createdAt,
      claimantName: users.displayName,
      claimantEmail: users.email,
    })
    .from(listingClaims)
    .innerJoin(users, eq(users.id, listingClaims.userId))
    .where(eq(listingClaims.status, 'pending'))
    .orderBy(asc(listingClaims.createdAt))

  const typed = rows.filter((r) => isListingEntityType(r.entityType))
  if (typed.length === 0) return []

  const idsByType = new Map<ListingEntityType, string[]>()
  for (const r of typed) {
    const type = r.entityType as ListingEntityType
    const list = idsByType.get(type)
    if (list) list.push(r.entityId)
    else idsByType.set(type, [r.entityId])
  }
  const resolvedPerType = await Promise.all(
    [...idsByType.entries()].map(
      async ([type, ids]) => [type, await RESOLVERS[type]([...new Set(ids)])] as const,
    ),
  )
  const byType = new Map<ListingEntityType, Resolved>(resolvedPerType)

  // Owners per entity, one lookup each. Small n (a review queue), so kept simple.
  return Promise.all(
    typed.map(async (r) => {
      const type = r.entityType as ListingEntityType
      return {
        id: r.id,
        entityType: type,
        entityId: r.entityId,
        method: r.method,
        createdAt: r.createdAt,
        claimantName: r.claimantName,
        claimantEmail: r.claimantEmail,
        note: r.evidence?.note ?? null,
        facts: byType.get(type)?.get(r.entityId) ?? null,
        currentOwners: await listOwnersOf(type, r.entityId),
      }
    }),
  )
}

// #endregion

// #region owner listing for one entity (admin + invite UIs)

export interface OwnerRow {
  userId: string
  role: ListingOwnerRole
  displayName: string | null
  email: string | null
}

/** Who owns a listing, for the invite screen and admin dispute view. */
export async function listOwnersOf(entityType: ListingEntityType, entityId: string): Promise<OwnerRow[]> {
  const db = getDb()
  const rows = await db
    .select({
      userId: listingOwners.userId,
      role: listingOwners.role,
      displayName: users.displayName,
      email: users.email,
    })
    .from(listingOwners)
    .innerJoin(users, eq(users.id, listingOwners.userId))
    .where(and(eq(listingOwners.entityType, entityType), eq(listingOwners.entityId, entityId)))
    .orderBy(asc(listingOwners.createdAt))
  return rows.map((r) => ({
    userId: r.userId,
    role: r.role as ListingOwnerRole,
    displayName: r.displayName,
    email: r.email,
  }))
}

// #endregion
