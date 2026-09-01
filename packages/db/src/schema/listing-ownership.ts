import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { users } from './accounts'

// ---------------------------------------------------------------------------
// Listing ownership
//
// Lets a signed-in user CLAIM and then EDIT a listing they own, across the
// tools, photos and fields verticals. Sign-in only makes editing easier: it
// never gates anonymous submit or suggest-edit, which keep working untouched.
//
// The whole design turns on one rule: A CLAIM IS NOT PROOF. `user_teams` is
// self-asserted and so is a claim to own a listing. A self-asserted claim must
// never expose or mutate data someone else entered. So permission lives in a
// SEPARATE trusted table (listing_owners) that is only ever written after a
// verification passes or an admin decides. Reads and edits gate on that row,
// the way app/me/team/profile/queries.ts gates on team_profile_members, never
// on the claim itself.
//
// Polymorphic over four entity types. Grants already have their own
// team_profile_members with the same owner/editor/viewer vocabulary; this
// mirrors it rather than inventing a second one, so grants can move onto this
// model later without a rename.
//
// 'event' means a row in event_listings, the curated off-season listing with
// the cost, capacity, registration state and venue on it. It earned its own
// entity type once owners could edit: a tool with toolType 'offseason_event'
// is a page ABOUT an event and has none of those columns, so pointing an
// organiser at one gave them nothing of theirs to correct.
// ---------------------------------------------------------------------------

/** The listing tables a claim can point at. */
export const LISTING_ENTITY_TYPES = ['tool', 'album', 'field', 'event'] as const
export type ListingEntityType = (typeof LISTING_ENTITY_TYPES)[number]

/** Same three roles as team_profile_members, on purpose. 'viewer' may only read. */
export const LISTING_OWNER_ROLES = ['owner', 'editor', 'viewer'] as const
export type ListingOwnerRole = (typeof LISTING_OWNER_ROLES)[number]

/** owner and editor may write; viewer may not. */
export const LISTING_WRITE_ROLES: readonly ListingOwnerRole[] = ['owner', 'editor']

export const CLAIM_STATUSES = ['pending', 'verified', 'rejected'] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

/**
 * How a claim was (or would be) proven.
 *   self_submitted - the claimant is the signed-in user who created the row.
 *   repo_file      - a token committed to the listing's GitHub repo, then fetched.
 *   domain_email   - the claimant's verified email domain matches the listing's contact.
 *   invite         - an existing owner's single-use link.
 *   admin          - an admin decided it by hand.
 *   manual_review  - awaiting an admin because no automatic proof was available.
 */
export const CLAIM_METHODS = [
  'self_submitted',
  'repo_file',
  'domain_email',
  'invite',
  'admin',
  'manual_review',
] as const
export type ClaimMethod = (typeof CLAIM_METHODS)[number]

// ---------------------------------------------------------------------------
// listing_owners - the TRUSTED permission row.
//
// A row here means "this user may act on this listing at this role". It is only
// ever written after a verification passes, an invite is accepted, or an admin
// decides. Never write it straight from a claim. Every /me ownership read and
// every owner edit action gates on a row here.
// ---------------------------------------------------------------------------

export const listingOwners = pgTable(
  'listing_owners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** LISTING_ENTITY_TYPES. Not an FK: the targets live in unrelated tables. */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** LISTING_OWNER_ROLES */
    role: text('role').notNull().default('owner'),
    /** CLAIM_METHODS - how this ownership was earned, kept for audit and disputes. */
    verifiedVia: text('verified_via').notNull(),
    /** The owner who invited this member, when it came from an invite. */
    invitedBy: uuid('invited_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_owners_entity_user_idx').on(table.entityType, table.entityId, table.userId),
    index('listing_owners_user_idx').on(table.userId),
    index('listing_owners_entity_idx').on(table.entityType, table.entityId),
  ],
)

// ---------------------------------------------------------------------------
// listing_claims - the REQUEST and its audit trail.
//
// A claim records who asked, for what, by which method, and where it got to. A
// claim NEVER grants access on its own. An auto-verifiable method that passes,
// or an admin approval, is what writes the matching listing_owners row; until
// then a pending claim is just a request an admin can see.
//
// Claiming an already-owned listing never auto-succeeds: it lands as a pending
// dispute for an admin, so a second claimant cannot silently take control of
// something someone else set up.
// ---------------------------------------------------------------------------

/** Evidence carried on a claim, shape depends on `method`. */
export interface ClaimEvidence {
  /** repo_file: the repository URL and the token the claimant must commit. */
  repoUrl?: string
  token?: string
  /** repo_file: the raw file URL we last fetched, and what we found. */
  checkedUrl?: string
  /** domain_email: the domain that matched. */
  emailDomain?: string
  /** Free-text context the claimant gave, shown to the admin reviewer. */
  note?: string
}

export const listingClaims = pgTable(
  'listing_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** LISTING_ENTITY_TYPES */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** CLAIM_METHODS */
    method: text('method').notNull(),
    /** CLAIM_STATUSES. 'pending' is "held for review". */
    status: text('status').notNull().default('pending'),
    evidence: jsonb('evidence').$type<ClaimEvidence>(),
    /** An admin's note on why they approved or rejected. */
    reviewerNote: text('reviewer_note'),
    /** The admin (or the claimant, for a self-serve verify) who settled it. */
    decidedByUserId: uuid('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('listing_claims_status_idx').on(table.status),
    index('listing_claims_entity_idx').on(table.entityType, table.entityId),
    index('listing_claims_user_idx').on(table.userId),
  ],
)

// ---------------------------------------------------------------------------
// listing_invites - an owner handing access to someone they know.
//
// The route around the "no verification of who is on a team" problem: rather
// than trusting a fresh claimant, an existing owner mints a single-use link and
// sends it to the person themselves. Accepting the link is what writes the new
// listing_owners row. The raw token lives only in the URL; we store its sha256
// so a database read cannot mint a working link.
// ---------------------------------------------------------------------------

export const listingInvites = pgTable(
  'listing_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** LISTING_ENTITY_TYPES */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    /** Role the invitee gets on accept. LISTING_OWNER_ROLES, never 'owner'. */
    role: text('role').notNull().default('editor'),
    /** sha256 of the raw token. The raw token is only ever in the link. */
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Optional: pin the invite to one email so a leaked link is useless to
     * anyone else. Checked against the accepter's verified email.
     */
    email: text('email'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedByUserId: uuid('used_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('listing_invites_token_idx').on(table.tokenHash),
    index('listing_invites_entity_idx').on(table.entityType, table.entityId),
  ],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const listingOwnersRelations = relations(listingOwners, ({ one }) => ({
  user: one(users, { fields: [listingOwners.userId], references: [users.id] }),
}))

export const listingClaimsRelations = relations(listingClaims, ({ one }) => ({
  user: one(users, { fields: [listingClaims.userId], references: [users.id] }),
}))

export const listingInvitesRelations = relations(listingInvites, ({ one }) => ({
  invitedBy: one(users, { fields: [listingInvites.invitedByUserId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ListingOwner = typeof listingOwners.$inferSelect
export type NewListingOwner = typeof listingOwners.$inferInsert
export type ListingClaim = typeof listingClaims.$inferSelect
export type NewListingClaim = typeof listingClaims.$inferInsert
export type ListingInvite = typeof listingInvites.$inferSelect
export type NewListingInvite = typeof listingInvites.$inferInsert
