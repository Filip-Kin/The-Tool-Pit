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
] as const
export type NotificationSubject = (typeof NOTIFICATION_SUBJECTS)[number]

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Who hears about it. NOT NULL and cascading: an anonymous submission has
     * no row here at all, which is how "anonymous submissions stay anonymous"
     * is enforced by the schema rather than by remembering to check.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
