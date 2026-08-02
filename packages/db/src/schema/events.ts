import { pgTable, uuid, text, integer, date, timestamp, index, unique, primaryKey } from 'drizzle-orm/pg-core'
import { sql, relations } from 'drizzle-orm'
import { albums } from './albums'

// ---------------------------------------------------------------------------
// FRC events — authoritative records synced from The Blue Alliance.
// Not moderated: TBA is the source of truth. Albums attach to these.
// ---------------------------------------------------------------------------

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Full TBA event key, e.g. "2024mimid". Global dedup key. */
    tbaKey: text('tba_key').notNull().unique(),
    /** Short TBA event_code (lowercased), e.g. "mimid". Matches FiM URL slug. */
    eventCode: text('event_code').notNull(),
    year: integer('year').notNull(),
    name: text('name').notNull(),
    shortName: text('short_name'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    /** Competition week (1-based). Null for champs/offseason/unscheduled. */
    week: integer('week'),
    /** TBA event_type int + its human string. Stored verbatim. */
    eventType: integer('event_type'),
    eventTypeString: text('event_type_string'),
    city: text('city'),
    stateProv: text('state_prov'),
    country: text('country'),
    venue: text('venue'),
    website: text('website'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // tbaKey uniqueness comes from the column-level .unique() above.
    unique('events_code_year_uq').on(table.eventCode, table.year),
    // Full-text over name + code for search
    index('events_search_idx').using(
      'gin',
      sql`to_tsvector('english', ${table.name} || ' ' || ${table.eventCode})`,
    ),
    // Trigram indexes for fuzzy / prefix search (requires pg_trgm extension)
    index('events_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
    index('events_code_trgm_idx').using('gin', sql`${table.eventCode} gin_trgm_ops`),
    index('events_start_date_idx').on(table.startDate),
    index('events_year_idx').on(table.year),
  ],
)

// ---------------------------------------------------------------------------
// Many-to-many: events ↔ teams (by team number). Powers team → events search.
// Populated by the TBA sync alongside events.
// ---------------------------------------------------------------------------

export const eventTeams = pgTable(
  'event_teams',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    /** FIRST team number (1–99999). */
    teamNumber: integer('team_number').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.teamNumber] }),
    index('event_teams_team_number_idx').on(table.teamNumber),
  ],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const eventsRelations = relations(events, ({ many }) => ({
  albums: many(albums),
  eventTeams: many(eventTeams),
}))

export const eventTeamsRelations = relations(eventTeams, ({ one }) => ({
  event: one(events, { fields: [eventTeams.eventId], references: [events.id] }),
}))

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Event = typeof events.$inferSelect
export type NewEvent = typeof events.$inferInsert
export type EventTeam = typeof eventTeams.$inferSelect
export type NewEventTeam = typeof eventTeams.$inferInsert
