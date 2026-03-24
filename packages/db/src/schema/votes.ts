import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { tools } from './tools'

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
    /** Hashed IP address for abuse detection only. Never store raw IPs. */
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tool_votes_unique').on(table.toolId, table.voterFingerprint),
    index('tool_votes_tool_id_idx').on(table.toolId),
    index('tool_votes_voter_idx').on(table.voterFingerprint),
  ],
)

export const toolVotesRelations = relations(toolVotes, ({ one }) => ({
  tool: one(tools, { fields: [toolVotes.toolId], references: [tools.id] }),
}))

export type ToolVote = typeof toolVotes.$inferSelect
export type NewToolVote = typeof toolVotes.$inferInsert
