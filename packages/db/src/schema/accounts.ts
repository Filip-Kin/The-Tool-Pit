import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Accounts
//
// Shared by ALL four verticals (tools, photos, fields, grants), not owned by
// any one of them. Sign-in is Firebase Auth; the server verifies the ID token
// and looks the user up by `firebaseUid`. We keep our own row rather than
// leaning on Firebase's user record so favourites, team membership and
// notification preferences can be joined in SQL.
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Firebase Auth `uid`. The only identifier the client can prove. */
    firebaseUid: text('firebase_uid').notNull(),
    email: text('email'),
    /** Firebase's own email_verified claim, copied at sign-in. */
    emailVerified: boolean('email_verified').notNull().default(false),
    displayName: text('display_name'),
    photoUrl: text('photo_url'),
    /**
     * Site admin. Deliberately NOT derived from a Firebase custom claim, so
     * granting admin is a DB change and cannot be self-asserted by a client.
     * The existing Authelia-based /admin gate stays as-is; this is for
     * per-vertical moderation later.
     */
    isAdmin: boolean('is_admin').notNull().default(false),
    /** Free-text ban reason. Non-null = signed in but blocked from writing. */
    blockedReason: text('blocked_reason'),
    /**
     * A linked GitHub account, used to grant ownership of listings built from
     * that account's repositories. See listing-ownership.ts, method
     * 'github_account'.
     *
     * The OAuth access token is deliberately absent. Firebase hands it to the
     * browser once, at the moment of sign-in or link; we use it for two
     * read-only API calls and drop it. Storing it would turn this table into a
     * store of other people's GitHub credentials for no gain, because the only
     * thing we need afterwards is the identity below.
     *
     * `githubLogin` is for display and is NOT an identity: GitHub logins are
     * renamed, and a freed login is handed to the next person who asks for it.
     * `githubUserId` is the numeric id, which never changes and is never
     * reissued, so that is what carries the unique index.
     */
    githubLogin: text('github_login'),
    githubUserId: text('github_user_id'),
    githubLinkedAt: timestamp('github_linked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_firebase_uid_idx').on(table.firebaseUid),
    index('users_email_idx').on(table.email),
    // One GitHub identity, one account here. Without this a second TTP account
    // could link the same GitHub user and collect the same grants, which would
    // make the audit trail on listing_owners meaningless. Postgres treats NULLs
    // as distinct, so every unlinked account still fits.
    uniqueIndex('users_github_user_id_idx').on(table.githubUserId),
  ],
)

// ---------------------------------------------------------------------------
// Favourites
//
// Polymorphic on purpose: one table serves every vertical so the signed-in
// home page is a single query. `entityType` is a string rather than an FK
// union because the four targets live in four unrelated tables; the reading
// code fans out per type. Deletes in the target table leave a dangling
// favourite, which the read path filters out - cheaper than four FKs.
// ---------------------------------------------------------------------------

export const FAVORITE_ENTITY_TYPES = ['tool', 'album', 'event', 'field', 'grant'] as const
export type FavoriteEntityType = (typeof FAVORITE_ENTITY_TYPES)[number]

export const favorites = pgTable(
  'favorites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** FAVORITE_ENTITY_TYPES */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    /** Optional user note on why they saved it. */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('favorites_user_entity_idx').on(table.userId, table.entityType, table.entityId),
    index('favorites_user_type_idx').on(table.userId, table.entityType),
  ],
)

// ---------------------------------------------------------------------------
// Team membership
//
// A user follows or belongs to one or more teams. `verified` is reserved for a
// later ownership check (e.g. an email at the team's domain, or an existing
// member vouching); until then everything is self-asserted and only ever
// affects that user's own view.
// ---------------------------------------------------------------------------

export const TEAM_MEMBER_ROLES = ['student', 'mentor', 'lead_mentor', 'alum', 'supporter'] as const
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number]

export const userTeams = pgTable(
  'user_teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** frc | ftc | fll - matches events.program. */
    program: text('program').notNull().default('frc'),
    teamNumber: integer('team_number').notNull(),
    /** TEAM_MEMBER_ROLES */
    role: text('role').notNull().default('student'),
    /** True once we have actually confirmed this person is on this team. */
    verified: boolean('verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_teams_user_team_idx').on(table.userId, table.program, table.teamNumber),
    index('user_teams_team_idx').on(table.program, table.teamNumber),
  ],
)

// ---------------------------------------------------------------------------
// Notification channels
//
// One row per delivery endpoint. Email addresses are verified with a token
// before anything is sent to them, so a signed-in user cannot subscribe
// someone else's inbox. Push endpoints come from the browser's PushManager.
// ---------------------------------------------------------------------------

export const notificationChannels = pgTable(
  'notification_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** ALERT_CHANNELS: email | push */
    kind: text('kind').notNull(),
    /** Email address for `email`; the endpoint URL for `push`. */
    address: text('address').notNull(),
    /** Web Push keys ({ p256dh, auth }) and user agent, for `push` only. */
    pushKeys: jsonb('push_keys').$type<{ p256dh: string; auth: string; userAgent?: string }>(),
    verified: boolean('verified').notNull().default(false),
    /** Hashed verification token, cleared once used. */
    verifyTokenHash: text('verify_token_hash'),
    verifyExpiresAt: timestamp('verify_expires_at', { withTimezone: true }),
    /** Consecutive delivery failures. A push endpoint 410s when uninstalled. */
    failureCount: integer('failure_count').notNull().default(0),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_channels_user_address_idx').on(table.userId, table.kind, table.address),
    index('notification_channels_user_idx').on(table.userId),
  ],
)

export const usersRelations = relations(users, ({ many }) => ({
  favorites: many(favorites),
  teams: many(userTeams),
  channels: many(notificationChannels),
}))

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, { fields: [favorites.userId], references: [users.id] }),
}))

export const userTeamsRelations = relations(userTeams, ({ one }) => ({
  user: one(users, { fields: [userTeams.userId], references: [users.id] }),
}))

export const notificationChannelsRelations = relations(notificationChannels, ({ one }) => ({
  user: one(users, { fields: [notificationChannels.userId], references: [users.id] }),
}))

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Favorite = typeof favorites.$inferSelect
export type NewFavorite = typeof favorites.$inferInsert
export type UserTeam = typeof userTeams.$inferSelect
export type NewUserTeam = typeof userTeams.$inferInsert
export type NotificationChannel = typeof notificationChannels.$inferSelect
export type NewNotificationChannel = typeof notificationChannels.$inferInsert
