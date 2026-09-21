import { pgTable, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// discord_approval_messages
//
// One row per Discord post that a person can DECIDE on with a reaction. The
// approvals channel used to be a webhook: fire, forget, and the message was a
// dead end. It is now posted by the FRC.Tools bot, which means we own the
// message id, and owning the message id is what makes both directions work:
//
//   Discord -> site   A ✅ or ❌ from someone with the developer role arrives
//                     at the worker as a message id. This table says what that
//                     message is about, so the worker can ask the site to
//                     approve THAT field / album / claim.
//   site -> Discord   Approve on the admin page finds the message for the row
//                     it just decided and edits it, so the channel does not
//                     fill with posts that look open and are not.
//
// A notice with no entityId (a crawl summary, a parser failure, a grant, which
// needs the editor form) is posted but never written here, and gets no
// reactions. The absence of a row IS "this is not a decision".
//
// status is the lock. The moderate route flips 'pending' to a decision in the
// same statement it checks it, so two developers reacting in the same second
// produce one publish and one "already decided", not two publishes.
// ---------------------------------------------------------------------------

export const DISCORD_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const
export type DiscordApprovalStatus = (typeof DISCORD_APPROVAL_STATUSES)[number]

/** Where the decision was made. The embed says which, so the channel is an audit trail. */
export const DISCORD_DECISION_VIAS = ['discord', 'site'] as const
export type DiscordDecisionVia = (typeof DISCORD_DECISION_VIAS)[number]

export const discordApprovalMessages = pgTable(
  'discord_approval_messages',
  {
    /** Discord message snowflake. The bot posted it, so it is ours to edit. */
    messageId: text('message_id').primaryKey(),
    channelId: text('channel_id').notNull(),
    /** ApprovalVertical from @the-tool-pit/types. Loose text, not an enum, same as notification_outbox.subject. */
    vertical: text('vertical').notNull(),
    /**
     * The row the decision lands on. Which table depends on the vertical:
     * tool / robot_code -> submissions, album -> album_candidates,
     * field -> practice_fields, field_edit -> field_edit_proposals,
     * event -> event_listings, event_edit -> event_edit_proposals,
     * claim -> listing_claims. Text, not uuid, so a future vertical with a
     * different key shape does not need a migration.
     */
    entityId: text('entity_id').notNull(),
    /** DISCORD_APPROVAL_STATUSES */
    status: text('status').notNull().default('pending').$type<DiscordApprovalStatus>(),
    /** Display name of whoever decided, Discord member or site admin. An audit stamp, not an identity. */
    decidedBy: text('decided_by'),
    /** DISCORD_DECISION_VIAS */
    decidedVia: text('decided_via').$type<DiscordDecisionVia>(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The site -> Discord direction: "which message is about this row". One
    // pending message per row; a resubmission after a rejection is a new row
    // with a new id, so this never collides in practice, and if it ever did
    // the second post failing loudly beats two messages that both claim to be
    // the one to react to.
    uniqueIndex('discord_approval_messages_entity_idx').on(table.vertical, table.entityId),
    index('discord_approval_messages_status_idx').on(table.status),
  ],
)

export type DiscordApprovalMessage = typeof discordApprovalMessages.$inferSelect
export type NewDiscordApprovalMessage = typeof discordApprovalMessages.$inferInsert
