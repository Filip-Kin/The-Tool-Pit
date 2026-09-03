import { pgTable, uuid, text, integer, real, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { eventListings, type RosterTeam } from './event-listings'

// The value tuples live in ../event-enums (a zero-dependency module) so client
// components can import them without pulling the DB client into the browser
// bundle. Re-exported here so `@the-tool-pit/db` consumers get them from the
// barrel, the same arrangement ./event-listings.ts uses.
export { EVENT_LISTING_SOURCE_KINDS, EVENT_LISTING_CANDIDATE_STATUSES } from '../event-enums'
export type { EventListingSourceKind, EventListingCandidateStatus } from '../event-enums'

// ---------------------------------------------------------------------------
// Off-season event DISCOVERY
//
// Until this file existed the events vertical had no way in except a human
// typing a listing, which is why the directory only ever held what Filip had
// already put in his spreadsheet. Two angles feed it, because neither is
// enough on its own:
//
//   tba_offseason - TBA carries every off-season event somebody bothered to
//                   register, as structured JSON, with dates and a venue. It
//                   does NOT carry cost, capacity, whether registration is
//                   open, or an organiser email, and it does not list an event
//                   that is still only an idea on the forum.
//   chief_delphi  - the forum is where an event is announced MONTHS before it
//                   reaches TBA, which is exactly the window a team needs. It
//                   is also prose, so almost nothing is machine readable.
//
// THE RULE, the same one grants follow and the one the tools vertical broke:
// nothing on this path writes to `event_listings`. Discovery produces
// `event_listing_candidates` with status 'pending' and a human decides. The
// tools directory auto-published its crawl output and filled with forum
// threads and bot walls; an events directory that does the same publishes a
// date that is wrong, and a team drives four hours on a wrong date.
// ---------------------------------------------------------------------------

export const eventListingCrawlSources = pgTable(
  'event_listing_crawl_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** EVENT_LISTING_SOURCE_KINDS */
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    /** Page to crawl, the season endpoint, or the query string for a search source. */
    target: text('target').notNull(),
    /**
     * Connector-specific settings, e.g. extra search queries, or a list of
     * state/province codes to keep. Codes, not names: TBA files Michigan
     * off-season events as state_prov "MI" and filtering on "Michigan"
     * silently returns nothing.
     */
    config: jsonb('config').$type<Record<string, unknown>>(),
    enabled: boolean('enabled').notNull().default(true),
    cadenceHours: integer('cadence_hours').notNull().default(24),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** Rolling count of candidates from this source a human promoted to a listing. */
    yieldCount: integer('yield_count').notNull().default(0),
    /** Rolling count a human suppressed. High against yield = a noisy source. */
    rejectCount: integer('reject_count').notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('event_listing_crawl_sources_kind_idx').on(table.kind),
    index('event_listing_crawl_sources_enabled_idx').on(table.enabled),
  ],
)

export const eventListingCrawlJobs = pgTable(
  'event_listing_crawl_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => eventListingCrawlSources.id, { onDelete: 'set null' }),
    /** Connector name, e.g. `tba_offseason_events`, `cd_offseason_events`. */
    connector: text('connector').notNull(),
    /** queued | running | done | failed */
    status: text('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    stats: jsonb('stats').$type<EventListingCrawlStats>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('event_listing_crawl_jobs_connector_idx').on(table.connector),
    index('event_listing_crawl_jobs_status_idx').on(table.status),
    index('event_listing_crawl_jobs_created_at_idx').on(table.createdAt),
  ],
)

export const eventListingCandidates = pgTable(
  'event_listing_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').references(() => eventListingCrawlJobs.id, { onDelete: 'set null' }),
    sourceId: uuid('source_id').references(() => eventListingCrawlSources.id, { onDelete: 'set null' }),
    /** The page the lead was found ON: a TBA event page, a forum thread. */
    sourceUrl: text('source_url').notNull(),
    /** Dedup key: scheme+host+path, tracking parameters stripped. */
    canonicalUrl: text('canonical_url'),
    /**
     * TBA key when the lead came with one. Indexed because the first question
     * asked of every TBA lead is "do we already list this event", and
     * event_listings.tba_key is the answer.
     */
    tbaKey: text('tba_key'),
    rawMetadata: jsonb('raw_metadata').$type<RawEventListingMetadata>(),
    /**
     * Fields a connector read out DETERMINISTICALLY, ready for a reviewer to
     * accept into an event_listings row. A connector that is not certain of a
     * value leaves it undefined rather than guessing: an absent date is a
     * question, a wrong date is a wasted weekend.
     */
    extracted: jsonb('extracted').$type<ExtractedEventListingFields>(),
    /**
     * Null for every connector shipped today, all of which are deterministic.
     * Kept so a later classifier has somewhere to put its number without a
     * migration, and so the admin can sort by it if one ever arrives.
     */
    confidenceScore: real('confidence_score'),
    /** EVENT_LISTING_CANDIDATE_STATUSES. Always starts 'pending'. */
    status: text('status').notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    /** Set when a human promoted this lead into, or matched it to, a listing. */
    matchedListingId: uuid('matched_listing_id').references(() => eventListings.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('event_listing_candidates_job_idx').on(table.jobId),
    index('event_listing_candidates_status_idx').on(table.status),
    index('event_listing_candidates_canonical_url_idx').on(table.canonicalUrl),
    index('event_listing_candidates_tba_key_idx').on(table.tbaKey),
  ],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const eventListingCrawlSourcesRelations = relations(eventListingCrawlSources, ({ many }) => ({
  jobs: many(eventListingCrawlJobs),
  candidates: many(eventListingCandidates),
}))

export const eventListingCrawlJobsRelations = relations(eventListingCrawlJobs, ({ one, many }) => ({
  source: one(eventListingCrawlSources, {
    fields: [eventListingCrawlJobs.sourceId],
    references: [eventListingCrawlSources.id],
  }),
  candidates: many(eventListingCandidates),
}))

export const eventListingCandidatesRelations = relations(eventListingCandidates, ({ one }) => ({
  job: one(eventListingCrawlJobs, {
    fields: [eventListingCandidates.jobId],
    references: [eventListingCrawlJobs.id],
  }),
  source: one(eventListingCrawlSources, {
    fields: [eventListingCandidates.sourceId],
    references: [eventListingCrawlSources.id],
  }),
  matchedListing: one(eventListings, {
    fields: [eventListingCandidates.matchedListingId],
    references: [eventListings.id],
  }),
}))

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventListingCrawlSource = typeof eventListingCrawlSources.$inferSelect
export type NewEventListingCrawlSource = typeof eventListingCrawlSources.$inferInsert
export type EventListingCrawlJob = typeof eventListingCrawlJobs.$inferSelect
export type NewEventListingCrawlJob = typeof eventListingCrawlJobs.$inferInsert
export type EventListingCandidate = typeof eventListingCandidates.$inferSelect
export type NewEventListingCandidate = typeof eventListingCandidates.$inferInsert

/**
 * Counts written onto a crawl job. `errors` and `limits` are part of the shape
 * rather than bolted on at the write site, because a run that found nothing
 * and a run that was cut off by a per-run cap look identical without them, and
 * a silent cap reads as "we found everything there is".
 */
export interface EventListingCrawlStats {
  connector: string
  discovered: number
  new: number
  updated: number
  unchanged: number
  skipped: number
  failed: number
  errors: string[]
  limits: string[]
}

export interface RawEventListingMetadata {
  title?: string
  description?: string
  /** The exact query, thread or endpoint that produced this, for the reviewer. */
  discoveredVia?: string
  /**
   * The literal strings a parse keyed off, e.g. the "July 11-12, 2026" that
   * became a start date. A reviewer can check a parse they can see; they
   * cannot check a date that arrived with no working shown.
   */
  evidence?: string[]
  /** Outbound links found beside the lead, in the order they appeared. */
  links?: string[]
  /** TBA event_type int, kept verbatim: 99 offseason, 100 preseason. */
  tbaEventType?: number

  // What the model read, and what was thrown away doing it. Kept on the
  // candidate so a reviewer sees the sentence behind every filled field, and so
  // a re-run knows this one has already been read.
  /** ISO timestamp of the last model read. Absent means never read. */
  readAt?: string
  /** Field name to the quote that supports it and the page it came from. */
  readEvidence?: Record<string, { quote: string; source: string }>
  /** Every page the reader opened, in order. */
  readPages?: string[]
  /** Values the reader offered that the evidence did not support. */
  readRejected?: string[]
}

/**
 * Deterministically read fields, shaped to drop straight onto an
 * event_listings row. Everything is optional on purpose: cost, capacity,
 * registration state and an organiser email exist on no machine-readable
 * source we crawl, so they stay a human's job.
 */
export interface ExtractedEventListingFields {
  name?: string
  /** EVENT_PROGRAMS. Left undefined when the source did not say. */
  program?: string
  /** EVENT_STATUSES. What the site says about whether the event is happening (cancelled / tentative / confirmed). */
  eventStatus?: string
  hostTeamNumber?: number
  venueName?: string
  address?: string
  city?: string
  /** State / province. Short code from TBA, free text from the forum. */
  region?: string
  country?: string
  /** ISO yyyy-mm-dd. */
  startDate?: string
  endDate?: string
  /**
   * Competition days: 1 or 2, counted off the event's SCHEDULE as the distinct
   * days that play qualification or playoff matches. A load-in / move-in day,
   * and a load-in day whose only matches are practice matches, do not count.
   * The schedule is authoritative over the date span; the span is a fallback
   * only when no schedule is found.
   */
  days?: number
  /** ISO yyyy-mm-dd, when the source states the date team sign-ups open. */
  registrationOpensAt?: string
  /** ISO yyyy-mm-dd, when the source states the registration deadline, the date team sign-ups close. */
  registrationClosesAt?: string
  website?: string
  registrationUrl?: string
  chiefDelphiUrl?: string
  tbaKey?: string

  // Fields the deterministic connectors never filled, because a thread does not
  // carry them in a form a regex can read. A model that reads the thread AND
  // the event's own site does: "Location: Capistrano Valley High School,
  // Mission Viejo, California" is a venue, a city and a state, and the cost is
  // on the /pay page the thread links to.
  volunteerUrl?: string
  /** The page on the event's own site listing the teams attending. */
  teamListUrl?: string
  /**
   * The registered teams scraped from teamListUrl at read time, so a moderator
   * can review the team list BEFORE publishing rather than after. Numbers only
   * (with waitlist flags); names are resolved from TBA at display, same as a
   * published roster. Carried onto the listing's first roster snapshot on accept.
   */
  rosterTeams?: RosterTeam[]
  /** Count of registered (non-waitlist) teams in rosterTeams, for the review row. */
  registeredTeamCount?: number
  contactEmail?: string
  /**
   * Looked up from the venue and address, not read off a page.
   *
   * A listing needs a pin before it can go on the map, and "Capistrano Valley
   * High School, Mission Viejo, CA" is a map search rather than a judgement.
   * Only ever filled from a real address or a named venue with a town behind
   * it: vague prose gets no pin, because a plausible marker in the wrong car
   * park is worse than an empty map.
   */
  latitude?: number
  longitude?: number
  capacity?: number
  costUsd?: number
  costNote?: string
  /** REGISTRATION_STATUSES. */
  registrationStatus?: string
  /** VOLUNTEER_STATUSES. */
  volunteerStatus?: string
  notes?: string
}

/**
 * One extracted value, with the words that support it and where they came from.
 *
 * A value with no quote is a guess, and this vertical has no room for guesses:
 * a wrong venue sends a team to the wrong building. The quote is checked
 * against the source text before the value is allowed anywhere near a column,
 * the same way the grants extractor does it.
 */
export interface EventExtractedField<T> {
  value: T | null
  quote: string | null
  source: 'thread' | 'website' | null
}

/** Per-field evidence, kept beside the candidate for the reviewer to read. */
export type EventFieldEvidence = Record<string, { quote: string; source: string }>
