import { pgTable, uuid, text, timestamp, index, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { tools } from './tools'
import { users } from './accounts'

export const toolVotes = pgTable(
  'tool_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    /**
     * Hashed (cookie_id + lightweight browser fingerprint).
     * Never store raw PII.
     */
    voterFingerprint: text('voter_fingerprint').notNull(),
    /**
     * The account that cast it, when there was one.
     *
     * A vote used to be keyed ONLY to voterFingerprint, which is a hash of an
     * httpOnly cookie. That means a vote belongs to a browser, not a person, so
     * signing in on a second browser showed none of your upvotes and clearing
     * cookies lost every one of them. The count was right and the button was
     * wrong, which is the worst shape for this bug to take because the data
     * looks fine.
     *
     * Nullable on purpose: voting stays open to a signed-out visitor, which is
     * most of them. The cookie is still written for everyone, so an anonymous
     * vote can be claimed by the account that signs in from that browser later.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Hashed IP address for abuse detection only. Never store raw IPs. */
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tool_votes_unique').on(table.toolId, table.voterFingerprint),
    /**
     * One vote per person per tool, however many browsers they use. Without
     * this, claiming anonymous votes at sign-in would let one account hold two
     * rows for the same tool and the count would drift up on every new device.
     * Partial, because a NULL userId is the signed-out case and there are many.
     */
    uniqueIndex('tool_votes_user_unique')
      .on(table.toolId, table.userId)
      .where(sql`user_id is not null`),
    index('tool_votes_tool_id_idx').on(table.toolId),
    index('tool_votes_voter_idx').on(table.voterFingerprint),
    index('tool_votes_user_idx').on(table.userId),
  ],
)

export const toolVotesRelations = relations(toolVotes, ({ one }) => ({
  tool: one(tools, { fields: [toolVotes.toolId], references: [tools.id] }),
}))

export type ToolVote = typeof toolVotes.$inferSelect
export type NewToolVote = typeof toolVotes.$inferInsert
