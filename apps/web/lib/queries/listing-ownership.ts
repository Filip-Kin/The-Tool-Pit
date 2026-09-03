import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { getDb } from '@/lib/db'
import {
  albumCandidates,
  albumSubmissions,
  albums,
  eventListings,
  events,
  grantCandidates,
  grantFunders,
  grants,
  listingClaims,
  listingOwners,
  practiceFields,
  submissions,
  toolLinks,
  tools,
  users,
  LISTING_ENTITY_TYPES,
  LISTING_WRITE_ROLES,
  coerceOwnerRole,
  type ClaimStatus,
  type ListingEntityType,
  type ListingOwnerRole,
} from '@the-tool-pit/db'
import {
  EXTRA_LINKS_KEY,
  OWNER_LINK_TYPES,
  linkFieldKey,
  listingFormSpec,
  type ExtraLink,
  type ListingFieldSpec,
  type ListingFormContext,
  type OwnerLinkType,
} from '@/components/me/listing-fields'
import { loadExtraToolLinks } from '@/lib/listings/tool-links'
import { loadToolTaxonomy, taxonomyOptions, type TaxonomyOptions } from '@/lib/listings/tool-taxonomy'
import { displayEventName } from './albums'
import { getCurrentUser } from '@/lib/auth/session'

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

async function resolveEvents(ids: string[]): Promise<Resolved> {
  const db = getDb()
  const rows = await db
    .select({
      id: eventListings.id,
      name: eventListings.name,
      city: eventListings.city,
      region: eventListings.region,
      startDate: eventListings.startDate,
      status: eventListings.status,
    })
    .from(eventListings)
    .where(inArray(eventListings.id, ids))
  const out: Resolved = new Map()
  for (const r of rows) {
    const place = [r.city, r.region].filter(Boolean).join(', ')
    const status = r.status === 'published' ? null : `(${r.status})`
    out.set(r.id, {
      title: r.name,
      subtitle: [r.startDate, place, status].filter(Boolean).join(' · ') || null,
      href: `/events/${r.id}`,
    })
  }
  return out
}

async function resolveGrants(ids: string[]): Promise<Resolved> {
  const db = getDb()
  const rows = await db
    .select({
      id: grants.id,
      slug: grants.slug,
      name: grants.name,
      summary: grants.summary,
      status: grants.status,
      funderName: grantFunders.name,
    })
    .from(grants)
    .leftJoin(grantFunders, eq(grantFunders.id, grants.funderId))
    .where(inArray(grants.id, ids))
  const out: Resolved = new Map()
  for (const r of rows) {
    const status = r.status === 'published' ? null : `(${r.status})`
    out.set(r.id, {
      title: r.name,
      subtitle: [r.funderName, r.summary, status].filter(Boolean).join(' · ') || null,
      href: `/grants/${r.slug}`,
    })
  }
  return out
}

const RESOLVERS: Record<ListingEntityType, (ids: string[]) => Promise<Resolved>> = {
  tool: resolveTools,
  album: resolveAlbums,
  field: resolveFields,
  event: resolveEvents,
  grant: resolveGrants,
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
    const role = coerceOwnerRole(row.role)
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
  return row ? coerceOwnerRole(row.role) : null
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
 * What a public detail page should offer the visitor about ownership.
 *
 * The button used to render "Claim this listing" to anyone signed in, on every
 * listing, including ones they already owned. So the site invited a person to
 * claim a thing that was already theirs, which reads as broken however the
 * claim page then behaves.
 *
 * Resolved on the server because all three inputs are server state: who is
 * signed in, who owns the row, and whether this person has a claim in flight.
 * A client component cannot know any of them without a round trip.
 */
export type ListingClaimState =
  /** Nobody is signed in. Claiming needs an account, so offer nothing. */
  | 'signed_out'
  /** This visitor owns it. Offer the edit page instead. */
  | 'owner'
  /** This visitor has already asked. Say so rather than asking again. */
  | 'claim_pending'
  /** Someone else owns it. Not claimable, and not the visitor's business. */
  | 'owned_by_other'
  /** Nobody owns it and nothing is pending. This is the only claimable case. */
  | 'claimable'

export async function listingClaimState(
  entityType: ListingEntityType,
  entityId: string,
): Promise<ListingClaimState> {
  const states = await listingClaimStates(entityType, [entityId])
  return states.get(entityId) ?? 'signed_out'
}

/**
 * The same answer for a whole grid, in two queries rather than two per card.
 *
 * A card can carry the ownership control now, and a championship event page
 * draws eight album cards while the practice field map draws every published
 * field at once. Resolving each one on its own would put a pair of round trips
 * behind every tile on the page, which is the shape of slowness that only
 * shows up once the data grows. Same fan-out rule as getVotedToolIds: one
 * lookup for the set, keyed by id on the way out.
 *
 * Ids missing from the returned map never happen; every id asked for gets an
 * entry, so a caller can index it without a fallback branch per card.
 */
export async function listingClaimStates(
  entityType: ListingEntityType,
  entityIds: string[],
): Promise<Map<string, ListingClaimState>> {
  const out = new Map<string, ListingClaimState>()
  const ids = [...new Set(entityIds)]
  if (ids.length === 0) return out

  const user = await getCurrentUser()
  if (!user) {
    for (const id of ids) out.set(id, 'signed_out')
    return out
  }

  const db = getDb()
  const [owners, pending] = await Promise.all([
    // Every owner of these listings, not just this user's rows: "owned by
    // someone else" is what stops a second person being invited to take one.
    db
      .select({ entityId: listingOwners.entityId, userId: listingOwners.userId })
      .from(listingOwners)
      .where(and(eq(listingOwners.entityType, entityType), inArray(listingOwners.entityId, ids))),
    db
      .select({ entityId: listingClaims.entityId })
      .from(listingClaims)
      .where(
        and(
          eq(listingClaims.userId, user.id),
          eq(listingClaims.entityType, entityType),
          inArray(listingClaims.entityId, ids),
          eq(listingClaims.status, 'pending'),
        ),
      ),
  ])

  const mine = new Set(owners.filter((r) => r.userId === user.id).map((r) => r.entityId))
  const anyOwner = new Set(owners.map((r) => r.entityId))
  const mineClaimed = new Set(pending.map((r) => r.entityId))

  for (const id of ids) {
    if (mine.has(id)) out.set(id, 'owner')
    else if (mineClaimed.has(id)) out.set(id, 'claim_pending')
    else if (anyOwner.has(id)) out.set(id, 'owned_by_other')
    else out.set(id, 'claimable')
  }
  return out
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
   * True when the signed-in user is the one who submitted this listing, AND
   * they did not tick "I am only passing this along" when they did.
   *
   * The strongest proof on the site short of a repo file: we wrote the
   * submitter id ourselves, off the session, at the moment the row was created.
   * It short-circuits to instant ownership in the claim action.
   *
   * Every vertical carries it now, not just fields and events. It is what
   * closes the gap for everything approved BEFORE ownership was granted at
   * approval: those rows have an owner-less listing and a submitter id, and
   * this is how their submitter gets it back without a data migration.
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

  const repoUrl = entityType === 'tool' ? await findToolRepoUrl(entityId) : null
  const isSelfSubmitted = await submittedByThisUser(entityType, entityId, userId)

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

/**
 * Did THIS user submit this listing, and did they want it?
 *
 * Two questions, one answer, because either one alone is the wrong answer. A
 * submitter id with submitter_owns = false is somebody who explicitly said the
 * thing was not theirs, and handing it to them anyway on the claim page would
 * make the checkbox on the submit form a lie. A NULL submitter_owns is a row
 * from before the form asked: they were never given the chance to decline, so
 * their submission still counts as the evidence it always was.
 *
 * A field or an event IS the submitted row. A tool, an album and a grant are
 * one hop away from theirs, through the column the publish step wrote when it
 * turned a submission into a listing.
 */
async function submittedByThisUser(
  entityType: ListingEntityType,
  entityId: string,
  userId: string,
): Promise<boolean> {
  const db = getDb()
  const owns = (row: { submittedByUserId: string | null; submitterOwns: boolean | null } | undefined) =>
    Boolean(row && row.submittedByUserId === userId && row.submitterOwns !== false)

  if (entityType === 'field') {
    const [row] = await db
      .select({ submittedByUserId: practiceFields.submittedByUserId, submitterOwns: practiceFields.submitterOwns })
      .from(practiceFields)
      .where(eq(practiceFields.id, entityId))
      .limit(1)
    return owns(row)
  }

  if (entityType === 'event') {
    const [row] = await db
      .select({ submittedByUserId: eventListings.submittedByUserId, submitterOwns: eventListings.submitterOwns })
      .from(eventListings)
      .where(eq(eventListings.id, entityId))
      .limit(1)
    return owns(row)
  }

  if (entityType === 'tool') {
    // submissions.resolved_tool_id is written when the pipeline publishes, so
    // it is the one link back from a live tool to the person who sent it in.
    const [row] = await db
      .select({ submittedByUserId: submissions.submittedByUserId, submitterOwns: submissions.submitterOwns })
      .from(submissions)
      .where(eq(submissions.resolvedToolId, entityId))
      .limit(1)
    return owns(row)
  }

  if (entityType === 'album') {
    const [row] = await db
      .select({
        submittedByUserId: albumSubmissions.submittedByUserId,
        submitterOwns: albumSubmissions.submitterOwns,
      })
      .from(albumCandidates)
      .innerJoin(albumSubmissions, eq(albumSubmissions.id, albumCandidates.submissionId))
      .where(eq(albumCandidates.matchedAlbumId, entityId))
      .limit(1)
    return owns(row)
  }

  const [row] = await db
    .select({ submittedByUserId: grantCandidates.submittedByUserId, submitterOwns: grantCandidates.submitterOwns })
    .from(grantCandidates)
    .where(eq(grantCandidates.matchedGrantId, entityId))
    .limit(1)
  return owns(row)
}

// #endregion

// #region load one listing for the owner edit form
//
// The select is BUILT FROM the form spec rather than written out beside it.
// Every caller has already proven canEditListing, so reading the whole row
// would be safe as far as permissions go, but a hand-written select next to a
// separate list of form fields is how a private column ends up in a form the
// day someone widens one and not the other. Deriving one from the other makes
// that impossible: a column that is not in components/me/listing-fields.ts is
// never read, and a spec entry with no matching column is never invented.
//
// Values come back as the strings and booleans an input holds, because the
// form is the only consumer and the action parses them straight back.

/**
 * One editable listing, flattened to what the form binds to.
 *
 * The two array members are the two fields that are not a column on the
 * listing's own table. string[] is a tag field, and it holds taxonomy slugs.
 * ExtraLink[] is the repeatable link list, which is a set of label and URL
 * pairs and so cannot be flattened into either of the other members. The form
 * narrows on field.kind before it touches a value, so nothing has to guess
 * which one it is holding.
 */
export type ListingFormValues = Record<string, string | boolean | string[] | ExtraLink[]>

export interface EditableListing {
  entityType: ListingEntityType
  facts: ListingFacts
  values: ListingFormValues
  /** Which variant of the vertical's form this listing gets. See listing-fields.ts. */
  formContext: ListingFormContext
  /** Options for the tag pickers, by field key. Empty for verticals with none. */
  tagOptions: TaxonomyOptions
}

/** The row each entity type edits. Keep in step with LISTING_ENTITY_TYPES. */
const EDIT_TABLES = {
  tool: tools,
  album: albums,
  field: practiceFields,
  event: eventListings,
  grant: grants,
} as const

/**
 * The spec fields for a vertical that are real columns on its own table.
 *
 * The single answer to "which keys may be read and written", shared by the
 * loader below and by the update set in app/me/listings/actions.ts. Link fields
 * live one table over and are handled separately, which is both the seven
 * `link_*` boxes and the repeatable `links` list; anything else the spec names
 * that is not a column is dropped here rather than reaching a query, so a typo
 * in the spec costs a missing input and never a failed update.
 */
export function listingColumnFields(
  entityType: ListingEntityType,
  context: ListingFormContext = {},
): ListingFieldSpec[] {
  const table = EDIT_TABLES[entityType] as unknown as Record<string, unknown>
  return listingFormSpec(entityType, context).fields.filter(
    (f) =>
      !f.key.startsWith('link_') &&
      f.kind !== 'tags' &&
      f.kind !== 'links' &&
      Object.hasOwn(table, f.key),
  )
}

/**
 * The facts about a listing that pick which form its owner gets.
 *
 * Read BEFORE anything else, because the select in loadListingForEdit and the
 * update set in the save action are both BUILT from the spec this chooses. A
 * tool already filed in the robot archive keeps its team and season boxes; an
 * ordinary tool has no archive group at all, so nothing on that form can reach
 * isTeamCode or isTeamCad.
 */
export async function loadListingFormContext(
  entityType: ListingEntityType,
  entityId: string,
): Promise<ListingFormContext> {
  if (entityType !== 'tool') return {}
  const db = getDb()
  const [row] = await db
    .select({ isTeamCode: tools.isTeamCode, isTeamCad: tools.isTeamCad })
    .from(tools)
    .where(eq(tools.id, entityId))
    .limit(1)
  return { inTeamArchive: Boolean(row?.isTeamCode || row?.isTeamCad) }
}

/** A db value as the input that owns it holds it. */
function toFormValue(kind: string, value: unknown): string | boolean {
  if (kind === 'checkbox') return Boolean(value)
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

export async function loadListingForEdit(
  entityType: ListingEntityType,
  entityId: string,
): Promise<EditableListing | null> {
  const db = getDb()
  const facts = (await RESOLVERS[entityType]([entityId])).get(entityId)
  if (!facts) return null

  const formContext = await loadListingFormContext(entityType, entityId)
  const table = EDIT_TABLES[entityType] as unknown as Record<string, PgColumn>
  const columnFields = listingColumnFields(entityType, formContext)
  const selection: Record<string, PgColumn> = {}
  for (const field of columnFields) selection[field.key] = table[field.key]

  const [row] = await db
    .select(selection)
    .from(EDIT_TABLES[entityType])
    .where(eq(table.id, entityId))
    .limit(1)
  if (!row) return null

  const values: ListingFormValues = {}
  for (const field of columnFields) values[field.key] = toFormValue(field.kind, row[field.key])

  // Tags and links are the two things on this form that are not columns, so
  // they are read on their own after the column pass, not selected with it.
  let tagOptions: TaxonomyOptions = {}
  if (entityType === 'tool') {
    for (const [type, url] of Object.entries(await loadToolLinks(entityId))) {
      values[linkFieldKey(type as OwnerLinkType)] = url
    }
    values[EXTRA_LINKS_KEY] = await loadExtraToolLinks(entityId)
    const [tags, options] = await Promise.all([loadToolTaxonomy(entityId), taxonomyOptions()])
    Object.assign(values, tags)
    tagOptions = options
  }

  return { entityType, facts, values, formContext, tagOptions }
}

/**
 * The owner-editable links on a tool, one URL per type.
 *
 * tool_links has no uniqueness on (tool_id, link_type) and a crawl can leave
 * two rows of the same type behind, so the newest wins here. A duplicate the
 * owner does not touch is left alone: collapsing rows nobody asked about would
 * mean an edit to one link quietly deleting another.
 */
export async function loadToolLinks(toolId: string): Promise<Partial<Record<OwnerLinkType, string>>> {
  const db = getDb()
  const rows = await db
    .select({ linkType: toolLinks.linkType, url: toolLinks.url, createdAt: toolLinks.createdAt })
    .from(toolLinks)
    .where(eq(toolLinks.toolId, toolId))
    .orderBy(asc(toolLinks.createdAt))

  const out: Partial<Record<OwnerLinkType, string>> = {}
  const owned = new Set<string>(OWNER_LINK_TYPES)
  for (const r of rows) {
    if (owned.has(r.linkType)) out[r.linkType as OwnerLinkType] = r.url
  }
  return out
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
    role: coerceOwnerRole(r.role),
    displayName: r.displayName,
    email: r.email,
  }))
}

// #endregion
