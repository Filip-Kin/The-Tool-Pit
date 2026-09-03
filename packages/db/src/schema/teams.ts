import { pgTable, integer, text, timestamp } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Team-name cache
//
// Event rosters scraped off registration pages, and TBA's own /event/*/teams
// endpoint, hand back team NUMBERS with at best a nickname and often nothing at
// all: CORI's list is 48, 144, 379 with no names. The roster table on a listing
// then shows bare numbers, which reads as a spreadsheet, not a field of teams.
//
// This is the one place a number turns back into a name. It is a plain cache of
// TBA's team directory, refreshed on its own weekly job (worker
// listings/tba-teams-sync.ts), and read once per roster render to fill any name
// the scrape did not carry. It is NOT authoritative over a scraped name: a name
// an event's own page published is kept, because it is what that event chose to
// call the team, and this only fills the gaps.
//
// Keyed by team number because a number is the one identifier every source
// agrees on. A team that TBA has never listed simply is not here, and a roster
// entry for it stays name-less, which the render already tolerates.
// ---------------------------------------------------------------------------

export const teams = pgTable('teams', {
  /** FRC team number. The primary key: TBA's team_number, one row per team. */
  number: integer('number').primaryKey(),
  /** Short public name TBA shows first, e.g. "Miracle Workerz". Preferred for display. */
  nickname: text('nickname'),
  /** Full/long name, usually the sponsor-and-school string. Fallback when there is no nickname. */
  name: text('name'),
  city: text('city'),
  stateProv: text('state_prov'),
  country: text('country'),
  /** When this row was last written by the TBA sync. */
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Team = typeof teams.$inferSelect
export type NewTeam = typeof teams.$inferInsert
