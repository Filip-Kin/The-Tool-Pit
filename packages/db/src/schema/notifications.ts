import { pgTable, uuid, text, timestamp, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { users } from './accounts'

// ---------------------------------------------------------------------------
// notification_outbox
//
// The site-wide version of grant_alerts. Same shape, same reasons, no vertical
// in its name, because every vertical here takes public submissions and holds
// them for a human, and every one of them owed the submitter an answer.
//
// WHY A TABLE AND NOT A SEND CALL IN THE APPROVAL ACTION
//
//   - IDEMPOTENCY. Every row carries a dedupeKey and this table has a unique
//     index on it, so writing one is ON CONFLICT DO NOTHING. An admin who
//     clicks Approve twice, a server action replayed on a retry, or a
//     re-publish after an unpublish all collapse to one row and one email.
//   - THE APPROVAL MUST NOT DEPEND ON THE EMAIL. Publishing the listing is the
//     part that matters. Writing a row here is one insert against a database
//     the action already has open; Resend being down, slow or misconfigured
//     cannot reach back and undo the publish, because nothing in the request
//     ever talks to Resend.
//   - AUDIT. "Did we tell them?" is a SELECT, not a guess at a log file.
//   - HONEST FAILURE. A row that cannot be delivered is parked with the reason
//     written on it and counted in the drain stats, rather than disappearing.
//
// The payload is deliberately SELF-CONTAINED: the drain never re-joins to the
// listing at send time. A field renamed between approval and send cannot
// rewrite an email that was already promised, and a listing deleted in between
// cannot make a queued row unrenderable.
// ---------------------------------------------------------------------------

/**
 * The listing tables a notification can be about. Loose strings, not an FK:
 * the targets live in unrelated tables, and this column is for the admin
 * looking at the outbox rather than for a join.
 */
export const NOTIFICATION_SUBJECTS = [
  'practice_field',
  'field_edit_proposal',
  'event_listing',
  'submission',
  'album_submission',
  'grant_candidate',
  'listing_claim',
  'listing_invite',
] as const
export type NotificationSubject = (typeof NOTIFICATION_SUBJECTS)[number]

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Who hears about it, when they have an account. Cascading, so deleting the
     * user takes their queued mail with them.
     *
     * NULLABLE, with one narrow exception to "a notification is about a user".
     * Almost every row here is a moderation outcome for a signed-in submitter,
     * and for those an anonymous submission still has no row at all: the write
     * side refuses to queue without a user, which is how "anonymous submissions
     * stay anonymous" is kept. The exception is outreach to a scraped public
     * contact that has no account (see recipientEmail): there the address is the
     * recipient and there is no user to point at. Exactly one of userId and
     * recipientEmail is set on any row; the drain reads whichever it finds.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /**
     * A raw address to deliver to, for a row with no account behind it.
     *
     * Set ONLY on rows whose recipient is a public contact we scraped, never
     * confirmed and that has no user: listing outreach is the one such kind.
     * The drain sends here directly instead of resolving a user's verified
     * address, so this bypasses the "must be a confirmed address" rule on
     * purpose, and the callers that write it are limited to admin-triggered,
     * one-per-listing sends. Null on every ordinary row.
     */
    recipientEmail: text('recipient_email'),
    /**
     * APPROVAL_EMAIL_KINDS in @the-tool-pit/types, e.g. 'field_published'.
     * Persisted, so these strings are an on-disk contract: add, never rename.
     */
    kind: text('kind').notNull(),
    /** ALERT_CHANNELS. Only 'email' is delivered today; 'push' rows are held. */
    channel: text('channel').notNull().default('email'),
    /** NOTIFICATION_SUBJECTS. What kind of thing this is about. */
    subjectType: text('subject_type'),
    /** Id of that thing in its own table. Not an FK, see subjectType. */
    subjectId: uuid('subject_id'),
    /** Everything the body needs: title, url, facts, changes, reviewer note. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    /**
     * Idempotency key. Shape in use: `<kind>:<subjectId>:<userId>`, so the
     * same outcome for the same person is one email however many times the
     * action runs.
     */
    dedupeKey: text('dedupe_key').notNull(),
    sendAfter: timestamp('send_after', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_outbox_dedupe_idx').on(table.dedupeKey),
    index('notification_outbox_pending_idx').on(table.sentAt, table.sendAfter),
    index('notification_outbox_user_idx').on(table.userId),
  ],
)

export const notificationOutboxRelations = relations(notificationOutbox, ({ one }) => ({
  user: one(users, { fields: [notificationOutbox.userId], references: [users.id] }),
}))

export type NotificationOutboxRow = typeof notificationOutbox.$inferSelect
export type NewNotificationOutboxRow = typeof notificationOutbox.$inferInsert

// ---------------------------------------------------------------------------
// email_suppressions
//
// The universal, accountless "never email this address again". One row per
// suppressed address, and both outbox drains check it before they send.
//
// KEYED ON THE ADDRESS, NOT A USER, and that is the whole point. The person who
// clicks unsubscribe in an outreach email has no account: the address IS the
// identity, so suppression has to live against the address or it cannot reach
// them. A signed-in reader who clicks the same footer link is suppressed the
// same way, by their address, which is why it is universal: it stops every kind
// of email to that inbox at once, not one category of it.
//
// The address is stored lower-cased. The unsubscribe LINK carries no stored
// secret: the /unsubscribe route re-derives a signature over the address with
// SESSION_SECRET (see ../email-suppression.ts), so this table needs no token
// column and a database dump hands nobody the ability to unsubscribe an address
// they do not control.
// ---------------------------------------------------------------------------

export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Lower-cased email address. Unique: one suppression per inbox. */
    email: text('email').notNull(),
    /** Where it came from, e.g. 'unsubscribe_link' or 'admin'. For the audit. */
    source: text('source').notNull().default('unsubscribe_link'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('email_suppressions_email_idx').on(table.email)],
)

export type EmailSuppression = typeof emailSuppressions.$inferSelect
export type NewEmailSuppression = typeof emailSuppressions.$inferInsert

// ---------------------------------------------------------------------------
// notification_category_mutes
//
// One row per (user, category) a reader has switched OFF. Absence means on, so
// the default is "we tell you", and a mute is an explicit opt-out the reader
// took. Categories are LISTING_EMAIL_CATEGORIES in @the-tool-pit/types; the id
// is a loose string here, not an enum, so adding a category is a UI change and
// not a migration.
//
// This gates only email that belongs to a signed-in user. Outreach has no user,
// so it is never muted here, only by the global suppression above.
// ---------------------------------------------------------------------------

export const notificationCategoryMutes = pgTable(
  'notification_category_mutes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** LISTING_EMAIL_CATEGORIES id, e.g. 'listing_outcome'. */
    category: text('category').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_category_mutes_user_category_idx').on(table.userId, table.category),
    index('notification_category_mutes_user_idx').on(table.userId),
  ],
)

export const notificationCategoryMutesRelations = relations(notificationCategoryMutes, ({ one }) => ({
  user: one(users, { fields: [notificationCategoryMutes.userId], references: [users.id] }),
}))

export type NotificationCategoryMute = typeof notificationCategoryMutes.$inferSelect
export type NewNotificationCategoryMute = typeof notificationCategoryMutes.$inferInsert
