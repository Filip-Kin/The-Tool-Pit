import { pgTable, uuid, text, integer, real, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { eventListings } from './event-listings'

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
  /** Competition days, derived from the dates when both are known. */
  days?: number
  website?: string
  registrationUrl?: string
  chiefDelphiUrl?: string
  tbaKey?: string
}
