import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { tools } from './tools'

// ---------------------------------------------------------------------------
// Click events (which link on a tool page was clicked)
// ---------------------------------------------------------------------------

export const toolClickEvents = pgTable(
  'tool_click_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    /**
     * Which link type was clicked:
     * homepage | docs | github | issues | changelog | other
     */
    linkType: text('link_type').notNull(),
    sessionId: text('session_id'),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tool_click_events_tool_id_idx').on(table.toolId),
    index('tool_click_events_created_at_idx').on(table.createdAt),
  ],
)

// ---------------------------------------------------------------------------
// Search events (query analytics)
// ---------------------------------------------------------------------------

export const searchEvents = pgTable(
  'search_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    query: text('query').notNull(),
    /** null = global search */
    programFilter: text('program_filter'),
    resultCount: integer('result_count').notNull().default(0),
    sessionId: text('session_id'),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('search_events_created_at_idx').on(table.createdAt),
    index('search_events_query_idx').on(table.query),
  ],
)

export const toolClickEventsRelations = relations(toolClickEvents, ({ one }) => ({
  tool: one(tools, { fields: [toolClickEvents.toolId], references: [tools.id] }),
}))

export type ToolClickEvent = typeof toolClickEvents.$inferSelect
export type SearchEvent = typeof searchEvents.$inferSelect
