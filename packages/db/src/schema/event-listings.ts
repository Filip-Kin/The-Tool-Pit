import { pgTable, uuid, text, integer, boolean, doublePrecision, date, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { users } from './accounts'

// Enum-like value tuples live in ../event-enums (a zero-dependency module) so
// client components can import them without pulling in the DB client. Re-export
// here so `@the-tool-pit/db` consumers still get them from the barrel.
//
// EVENT_PROGRAMS / EventProgram are deliberately NOT re-exported: events.ts
// already exports that name into the barrel with the same value tuple. Client
// components that need the program tuple import it from the
// @the-tool-pit/db/event-enums subpath directly, which never collides.
export {
  EVENT_STATUSES,
  REGISTRATION_STATUSES,
  VOLUNTEER_STATUSES,
  EVENT_LISTING_STATUSES,
  EVENT_LISTING_SOURCES,
  ROSTER_SNAPSHOT_STATUSES,
} from '../event-enums'
export type {
  EventStatus,
  RegistrationStatus,
  VolunteerStatus,
  EventListingStatus,
  EventListingSource,
  RosterSnapshotStatus,
} from '../event-enums'

// ---------------------------------------------------------------------------
// Off-season event listings (submission -> admin-approved -> published)
//
// This is the CURATED listing layer, deliberately separate from the
// authoritative `events` table synced from TBA. TBA never carries the things
// teams actually need when deciding whether to enter an off-season event -
// cost, capacity, whether registration is open, the venue address, an
// organiser email - and it never lists an event that was cancelled or is still
// in planning. So this table owns all of that, the same submit -> moderate
// pattern the practice-field map uses. When a listing corresponds to a real
// TBA event we keep its `tbaKey` to borrow the final roster and results.
//
// The columns map straight onto Filip's "FIM Off-Season Events" spreadsheet.
// ---------------------------------------------------------------------------

export const eventListings = pgTable(
  'event_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Identity
    /** EVENT_PROGRAMS. Most off-season events are FRC; a few are FTC too. */
    program: text('program').notNull().default('frc'),
    /** Event name shown on the pin and card, e.g. "Kettering Kickoff". */
    name: text('name').notNull(),
    /** Team number of the host org, when a single team runs it. Optional. */
    hostTeamNumber: integer('host_team_number'),

    // Place
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /** Venue name, kept apart from the street address (sheet stores both). */
    venueName: text('venue_name'),
    address: text('address'),
    city: text('city'),
    /** State / province. */
    region: text('region'),
    country: text('country'),

    // Season (the lifecycle axis, see the season region at the bottom)
    /**
     * The calendar year this listing belongs to, e.g. 2026 for "2026 Bot Bash".
     *
     * The offseason ends on 31 December, so an offseason listing's season is
     * simply the calendar year its dates fall in. Normally that is the year of
     * `startDate` and the two never disagree.
     *
     * It is a column and not a `date_part(start_date)` expression for three
     * reasons. A listing announced before its dates are set has no startDate
     * and still belongs to a season. Filtering the map on one indexed integer
     * beats date arithmetic against a moving "now" on every request. And an
     * admin can correct a season without editing dates that are correct, which
     * is the case a derived value cannot express at all.
     *
     * Nullable, because a listing with no dates and no stated year is a real
     * thing. A null season is treated as CURRENT, never as archived: a listing
     * nobody has dated yet must not silently vanish off the map.
     */
    seasonYear: integer('season_year'),
    /**
     * Last year's listing, when this one is its renewal.
     *
     * A renewal is a NEW ROW, never an edit of the old one. The 2026 row keeps
     * its own dates, its own capacity, its own roster snapshots and its own
     * URL, and those URLs get shared on Chief Delphi and have to keep meaning
     * what they meant. So "2027 Bot Bash" is a fresh row that points back at
     * "2026 Bot Bash", and following the chain gives the whole history of an
     * event and, with it, the people who run it: the renewal form carries the
     * previous listing's owners forward onto the new row.
     *
     * ON DELETE SET NULL, not cascade. Deleting a 2026 listing must not delete
     * the 2027 event that is about to happen.
     */
    previousListingId: uuid('previous_listing_id').references((): AnyPgColumn => eventListings.id, {
      onDelete: 'set null',
    }),

    // When
    startDate: date('start_date'),
    endDate: date('end_date'),
    /** Competition days: 1 or 2. Null when unknown. */
    days: integer('days'),
    /**
     * The sheet's "2x 1" / "2x 32" shape: two independent single-day
     * tournaments run in parallel the same weekend, each with its own capacity.
     * True marks that split so the UI can say "two 1-day events".
     */
    parallelDivisions: boolean('parallel_divisions').notNull().default(false),

    // Capacity + cost
    /** Team slots (sheet "Slots"). The denominator for the fullness signal. */
    capacity: integer('capacity'),
    /** Registration fee per team in whole US dollars. Null when unknown. */
    costUsd: integer('cost_usd'),
    /** Extra cost detail free text, e.g. "$450 for both days", "$200 2nd robot". */
    costNote: text('cost_note'),

    // Registration + volunteering
    /** REGISTRATION_STATUSES. */
    registrationStatus: text('registration_status').notNull().default('unknown'),
    /** A future open date, when the sheet gives one (e.g. "8/1"). */
    registrationOpensAt: date('registration_opens_at'),
    /** VOLUNTEER_STATUSES. */
    volunteerStatus: text('volunteer_status').notNull().default('unknown'),

    // Lifecycle (organiser's own state, NOT our moderation state below)
    /** EVENT_STATUSES. Sheet "Status" column. */
    eventStatus: text('event_status').notNull().default('confirmed'),

    // Links + contact
    /** The event's main site. Null when the only pointer is a Chief Delphi post. */
    website: text('website'),
    /** A dedicated registration / sign-up link, when it differs from the site. */
    registrationUrl: text('registration_url'),
    /** Where volunteers sign up. Usually a separate form from registration. */
    volunteerUrl: text('volunteer_url'),
    /** A Chief Delphi thread, for the "CD Post" events with no site of their own. */
    chiefDelphiUrl: text('chief_delphi_url'),
    /** Organiser contact email. */
    contactEmail: text('contact_email'),
    notes: text('notes'),

    // Link to the authoritative event, once one exists in `events`.
    /**
     * TBA/synthetic key of the matching row in `events`, e.g. "2026miket". Set
     * when this off-season listing has a real TBA event (mostly after it runs).
     * Lets the detail page show the final roster and results TBA holds. It is a
     * loose string link, not a FK, because the listing usually exists first.
     */
    tbaKey: text('tba_key'),

    // Fullness signal (denormalised from the latest approved roster snapshot,
    // so the map/list can render counts without joining every snapshot).
    /** Team count from the latest APPROVED roster snapshot. Null = none yet. */
    registeredTeamCount: integer('registered_team_count'),
    /** When that approved count was scraped. */
    teamCountUpdatedAt: timestamp('team_count_updated_at', { withTimezone: true }),

    // Moderation (mirrors practice_fields)
    /** EVENT_LISTING_STATUSES. Only published + has-coords listings show. */
    status: text('status').notNull().default('pending'),
    /** EVENT_LISTING_SOURCES. */
    source: text('source').notNull().default('submission'),
    rejectionReason: text('rejection_reason'),

    // Submitter audit (private - admin only)
    submitterName: text('submitter_name'),
    submitterContact: text('submitter_contact'),
    submitterIpHash: text('submitter_ip_hash'),
    /**
     * The signed-in user who submitted this, when there was one. Sign-in is
     * OPTIONAL here on purpose (same as fields): anonymous submissions stay
     * open so an organiser without an account can still list their event. A
     * separate session (feat/listing-ownership) builds the "claim your listing"
     * model on top of this column; leave that editing UX to them.
     */
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('event_listings_status_idx').on(table.status),
    index('event_listings_program_idx').on(table.program),
    index('event_listings_start_date_idx').on(table.startDate),
    index('event_listings_event_status_idx').on(table.eventStatus),
    index('event_listings_tba_key_idx').on(table.tbaKey),
    // Every public read of this table now filters on the season, so this index
    // carries the default map query rather than a reporting query.
    index('event_listings_season_year_idx').on(table.seasonYear),
    // Walked in both directions: "what did this renew" and "has anyone already
    // renewed this", which is the check that stops the April email asking about
    // an event whose next listing is already in the queue.
    index('event_listings_previous_listing_idx').on(table.previousListingId),
  ],
)

// ---------------------------------------------------------------------------
// Scraped roster snapshots (the fullness signal, gated like grant snapshots)
//
// The off-season emphasis is UPCOMING events, which have no TBA roster yet, so
// the "how full is it" number has to come from each event's own registration
// page. Off-season events register through wildly different systems, so this is
// deterministic-first (no AI): a connector fetches the page, parses a team
// list, and writes one snapshot per fetch.
//
// HARD RULE, same as grants: nothing scraped shows publicly until a human has
// approved it. A snapshot lands `pending`; an admin reviews the parsed list and
// approves, which promotes its count onto the listing. A trusted source can be
// marked to auto-approve future snapshots (still recorded here), so a page we
// have vetted once does not need re-approving every crawl.
// ---------------------------------------------------------------------------

/** One scraped team, as parsed off a registration page. */
export interface RosterTeam {
  number: number
  name?: string
}

export const eventRosterSnapshots = pgTable(
  'event_roster_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventListingId: uuid('event_listing_id')
      .notNull()
      .references(() => eventListings.id, { onDelete: 'cascade' }),
    /** The registration / teams page this was scraped from. */
    sourceUrl: text('source_url').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    httpStatus: integer('http_status'),
    /** Parsed team count (teams.length, kept explicit for cheap reads). */
    teamCount: integer('team_count'),
    /** The parsed team list. */
    teams: jsonb('teams').$type<RosterTeam[]>(),
    /**
     * Hash of the parsed team list, so an unchanged crawl is a no-op instead of
     * a fresh pending row every pass. Same idea as grant_snapshots.contentHash.
     */
    contentHash: text('content_hash'),
    /** False when contentHash matched the previous snapshot for this listing. */
    changed: boolean('changed').notNull().default(false),
    /** ROSTER_SNAPSHOT_STATUSES. Only 'approved' feeds the public listing. */
    status: text('status').notNull().default('pending'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('event_roster_snapshots_listing_idx').on(table.eventListingId),
    index('event_roster_snapshots_status_idx').on(table.status),
    index('event_roster_snapshots_fetched_at_idx').on(table.fetchedAt),
  ],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const eventListingsRelations = relations(eventListings, ({ many }) => ({
  rosterSnapshots: many(eventRosterSnapshots),
}))

export const eventRosterSnapshotsRelations = relations(eventRosterSnapshots, ({ one }) => ({
  listing: one(eventListings, { fields: [eventRosterSnapshots.eventListingId], references: [eventListings.id] }),
}))

// ---------------------------------------------------------------------------
// The season rule
//
// THE OFFSEASON SEASON IS THE CALENDAR YEAR. It ends on 31 December and the
// next one starts on 1 January. That is Filip's rule and it is the one the
// organisers use, so a "2026 offseason event" is any offseason event whose
// dates fall in 2026.
//
// DO NOT reuse the FTC or FRC competition-season convention that the `events`
// table uses. Over there the 2025-26 FTC season is stored as 2026 and TOA's
// "2223" means 2023, because a competition season straddles two calendar
// years. An offseason listing does not straddle anything. Mixing the two
// conventions in one database is how a listing ends up filed a year out.
//
// Everything below is pure arithmetic on a date. It lives beside the columns
// it explains so there is one definition of "which season is this" for the
// web app, the worker and the migration to agree on.
// ---------------------------------------------------------------------------

/**
 * The season one set of event dates belongs to: the calendar year of the start
 * date. Null when there is no date to read, which is the caller's cue to fall
 * back to the season we are currently in.
 *
 * Takes the raw `YYYY-MM-DD` string the `date` columns hold, and reads the year
 * off the front of it rather than through `new Date()`, because parsing a bare
 * date string gives midnight UTC and would file a 1 January event in the
 * previous year for anyone west of Greenwich.
 */
export function offseasonSeasonYear(startDate: string | null | undefined): number | null {
  if (!startDate) return null
  const year = Number.parseInt(startDate.slice(0, 4), 10)
  return Number.isInteger(year) && year > 1900 ? year : null
}

/**
 * The season that is running now. Rolls over at midnight on 1 January, in the
 * server's own zone, which is the whole archiving mechanism: on that date every
 * listing from the year before becomes historical in one step.
 */
export function currentOffseasonSeason(now: Date = new Date()): number {
  return now.getFullYear()
}

/**
 * True when this listing belongs to a season that has finished, so it is
 * hidden from the default view and reachable through the earlier-years view.
 *
 * A null season is NEVER archived. An undated listing is one somebody is still
 * putting together, and dropping it off the map would be the one failure mode
 * this whole feature must not have.
 */
export function isArchivedSeason(seasonYear: number | null | undefined, currentSeason: number): boolean {
  return seasonYear != null && seasonYear < currentSeason
}

// ---------------------------------------------------------------------------
// The renewal ask
// ---------------------------------------------------------------------------

/** April. The month the renewal email goes out in. Cron months are 1 based. */
export const SEASON_RENEWAL_MONTH = 4

/**
 * Mid-April. Far enough into the year that an organiser knows whether they are
 * running it again, early enough that they can still book a venue and open
 * registration before the summer events start.
 */
export const SEASON_RENEWAL_DAY = 15

/**
 * How many days running the renewal job is scheduled for, starting on
 * SEASON_RENEWAL_DAY.
 *
 * A once-a-year cron that fires on one day is one worker restart away from
 * skipping a whole season in silence, and nobody would find out until the
 * following April. So it is scheduled for a week instead. Every run after the
 * first is free: the dedupe key already holds the row, so the second through
 * seventh passes queue nothing.
 */
export const SEASON_RENEWAL_WINDOW_DAYS = 7

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventListing = typeof eventListings.$inferSelect
export type NewEventListing = typeof eventListings.$inferInsert
export type EventRosterSnapshot = typeof eventRosterSnapshots.$inferSelect
export type NewEventRosterSnapshot = typeof eventRosterSnapshots.$inferInsert
