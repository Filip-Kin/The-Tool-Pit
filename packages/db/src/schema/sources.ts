import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { tools } from './tools'

// ---------------------------------------------------------------------------
// Source evidence: where/how we discovered or confirmed a tool
// ---------------------------------------------------------------------------

export const toolSources = pgTable(
  'tool_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    /**
     * fta_tools | volunteer_systems | github | chief_delphi | tba |
     * submission | official_first | manual
     */
    sourceType: text('source_type').notNull(),
    sourceUrl: text('source_url'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    rawMetadata: jsonb('raw_metadata'),
    notes: text('notes'),
  },
  (table) => [
    index('tool_sources_tool_id_idx').on(table.toolId),
    index('tool_sources_type_idx').on(table.sourceType),
  ],
)

// ---------------------------------------------------------------------------
// Update/freshness evidence
// ---------------------------------------------------------------------------

export const toolUpdates = pgTable(
  'tool_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
    /**
     * github_push | github_release | page_change | cd_mention | manual
     */
    signalType: text('signal_type').notNull(),
    signalAt: timestamp('signal_at', { withTimezone: true }).notNull(),
    rawData: jsonb('raw_data'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tool_updates_tool_id_idx').on(table.toolId),
    index('tool_updates_signal_at_idx').on(table.signalAt),
  ],
)

export const toolSourcesRelations = relations(toolSources, ({ one }) => ({
  tool: one(tools, { fields: [toolSources.toolId], references: [tools.id] }),
}))

export const toolUpdatesRelations = relations(toolUpdates, ({ one }) => ({
  tool: one(tools, { fields: [toolUpdates.toolId], references: [tools.id] }),
}))

export type ToolSource = typeof toolSources.$inferSelect
export type NewToolSource = typeof toolSources.$inferInsert
export type ToolUpdate = typeof toolUpdates.$inferSelect
export type NewToolUpdate = typeof toolUpdates.$inferInsert
