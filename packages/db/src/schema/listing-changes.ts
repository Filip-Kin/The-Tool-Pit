import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// listing_changes
//
// One row per column an AUTOMATIC job wrote on a public listing: the weekly
// field and event refreshes, the monthly tool refresh. old_value is the FULL
// value the column held right before the write, read in the same transaction,
// so any automatic edit can be put back exactly (scripts in
// apps/worker/scripts/revert-listing-changes.ts).
//
// WHY. The first field refresh (2026-10-01) made 31 edits and 20 had to be
// reverted by hand from log lines that cut every value at 80 characters. A
// change a job makes on its own needs a record a person can undo from.
//
// listing_edits (listing-ownership.ts) is the other half: what an OWNER saved.
// This table is never written by a person's save.
// ---------------------------------------------------------------------------

/** Who wrote it. Loose text so a new job does not need a migration. */
export const LISTING_CHANGE_ACTORS = ['field-refresh', 'event-refresh', 'tool-refresh'] as const
export type ListingChangeActor = (typeof LISTING_CHANGE_ACTORS)[number]

export const listingChanges = pgTable(
  'listing_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'field' | 'event' | 'tool', the same words listing_owners uses. */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    /** The Drizzle (camelCase) key of the column, e.g. 'contactInfo'. */
    column: text('column').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    /** The words on the page the change was proven by, when there were any. */
    quote: text('quote'),
    sourceUrl: text('source_url'),
    actor: text('actor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('listing_changes_entity_idx').on(table.entityType, table.entityId, table.createdAt)],
)

export type ListingChange = typeof listingChanges.$inferSelect
export type NewListingChange = typeof listingChanges.$inferInsert
