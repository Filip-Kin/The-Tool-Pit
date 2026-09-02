import { pgTable, uuid, text, integer, real, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { practiceFields } from './fields'

// The value tuples live in ../field-enums (a zero-dependency module) so client
// components can import them without pulling the DB client into the browser
// bundle. Re-exported here so `@the-tool-pit/db` consumers get them from the
// barrel, the same arrangement ./fields.ts uses.
export { FIELD_CRAWL_SOURCE_KINDS, FIELD_CANDIDATE_STATUSES } from '../field-enums'
export type { FieldCrawlSourceKind, FieldCandidateStatus } from '../field-enums'

// ---------------------------------------------------------------------------
// Practice-field DISCOVERY
//
// The practice-field map only grew when a mentor happened to find the submit
// form. Teams offering field time do not go looking for a directory, they post
// "our field is open, come practice" on Chief Delphi and move on, so that is
// where the crawler has to look.
//
// There is no structured source here at all. Unlike off-season events, which
// TBA at least half-lists, a practice field exists nowhere as data. So one
// angle feeds this: forum threads, read deterministically, with everything
// that cannot be read deterministically left blank for a reviewer.
//
// THE RULE, same as grants and the same one the tools vertical broke: nothing
// here writes to `practice_fields`. Discovery produces
// `practice_field_candidates` with status 'pending' and a human decides. A
// wrong field listing sends a team to a building that will not let them in.
// ---------------------------------------------------------------------------

export const practiceFieldCrawlSources = pgTable(
  'practice_field_crawl_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FIELD_CRAWL_SOURCE_KINDS */
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    /** Page to crawl, or the query string for a search source. */
    target: text('target').notNull(),
    /** Connector-specific settings, e.g. extra search queries to run. */
    config: jsonb('config').$type<Record<string, unknown>>(),
    enabled: boolean('enabled').notNull().default(true),
    /**
     * Weekly by default, not daily. A practice field is offered a handful of
     * times a season and this is a volunteer-run forum, so a daily sweep would
     * be almost all repeat traffic for almost no new leads.
     */
    cadenceHours: integer('cadence_hours').notNull().default(168),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** Rolling count of candidates from this source a human promoted to a field. */
    yieldCount: integer('yield_count').notNull().default(0),
    /** Rolling count a human suppressed. High against yield = a noisy source. */
    rejectCount: integer('reject_count').notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('practice_field_crawl_sources_kind_idx').on(table.kind),
    index('practice_field_crawl_sources_enabled_idx').on(table.enabled),
  ],
)

export const practiceFieldCrawlJobs = pgTable(
  'practice_field_crawl_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => practiceFieldCrawlSources.id, { onDelete: 'set null' }),
    /** Connector name, e.g. `cd_practice_fields`. */
    connector: text('connector').notNull(),
    /** queued | running | done | failed */
    status: text('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    stats: jsonb('stats').$type<PracticeFieldCrawlStats>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('practice_field_crawl_jobs_connector_idx').on(table.connector),
    index('practice_field_crawl_jobs_status_idx').on(table.status),
    index('practice_field_crawl_jobs_created_at_idx').on(table.createdAt),
  ],
)

export const practiceFieldCandidates = pgTable(
  'practice_field_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').references(() => practiceFieldCrawlJobs.id, { onDelete: 'set null' }),
    sourceId: uuid('source_id').references(() => practiceFieldCrawlSources.id, { onDelete: 'set null' }),
    /** The page the lead was found ON, almost always a forum thread. */
    sourceUrl: text('source_url').notNull(),
    /** Dedup key: scheme+host+path, tracking parameters stripped. */
    canonicalUrl: text('canonical_url'),
    /**
     * Team number when the thread named one, e.g. "Team 3538 practice field".
     * Indexed because the first question asked of a lead is "do we already
     * list this team's field", and practice_fields.team_number answers it.
     */
    teamNumber: integer('team_number'),
    rawMetadata: jsonb('raw_metadata').$type<RawPracticeFieldMetadata>(),
    /**
     * Fields read DETERMINISTICALLY, ready for a reviewer to accept. Field
     * SPEC (coverage, perimeter, elements, FMS, ceiling height) is deliberately
     * not in here: a thread mentioning "full field" is not the same as the team
     * saying its field is full, and a wrong spec is what makes a team drive out
     * to a half field. Those mentions go in rawMetadata.signals as evidence.
     */
    extracted: jsonb('extracted').$type<ExtractedPracticeFieldFields>(),
    /**
     * Null for the connectors shipped today, all of which are deterministic.
     * Kept so a later classifier has somewhere to put its number without a
     * migration.
     */
    confidenceScore: real('confidence_score'),
    /** FIELD_CANDIDATE_STATUSES. Always starts 'pending'. */
    status: text('status').notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    /** Set when a human promoted this lead into, or matched it to, a field. */
    matchedFieldId: uuid('matched_field_id').references(() => practiceFields.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('practice_field_candidates_job_idx').on(table.jobId),
    index('practice_field_candidates_status_idx').on(table.status),
    index('practice_field_candidates_canonical_url_idx').on(table.canonicalUrl),
    index('practice_field_candidates_team_number_idx').on(table.teamNumber),
  ],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const practiceFieldCrawlSourcesRelations = relations(practiceFieldCrawlSources, ({ many }) => ({
  jobs: many(practiceFieldCrawlJobs),
  candidates: many(practiceFieldCandidates),
}))

export const practiceFieldCrawlJobsRelations = relations(practiceFieldCrawlJobs, ({ one, many }) => ({
  source: one(practiceFieldCrawlSources, {
    fields: [practiceFieldCrawlJobs.sourceId],
    references: [practiceFieldCrawlSources.id],
  }),
  candidates: many(practiceFieldCandidates),
}))

export const practiceFieldCandidatesRelations = relations(practiceFieldCandidates, ({ one }) => ({
  job: one(practiceFieldCrawlJobs, {
    fields: [practiceFieldCandidates.jobId],
    references: [practiceFieldCrawlJobs.id],
  }),
  source: one(practiceFieldCrawlSources, {
    fields: [practiceFieldCandidates.sourceId],
    references: [practiceFieldCrawlSources.id],
  }),
  matchedField: one(practiceFields, {
    fields: [practiceFieldCandidates.matchedFieldId],
    references: [practiceFields.id],
  }),
}))

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PracticeFieldCrawlSource = typeof practiceFieldCrawlSources.$inferSelect
export type NewPracticeFieldCrawlSource = typeof practiceFieldCrawlSources.$inferInsert
export type PracticeFieldCrawlJob = typeof practiceFieldCrawlJobs.$inferSelect
export type NewPracticeFieldCrawlJob = typeof practiceFieldCrawlJobs.$inferInsert
export type PracticeFieldCandidate = typeof practiceFieldCandidates.$inferSelect
export type NewPracticeFieldCandidate = typeof practiceFieldCandidates.$inferInsert

/** Same shape and same reasoning as EventListingCrawlStats. */
export interface PracticeFieldCrawlStats {
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

export interface RawPracticeFieldMetadata {
  title?: string
  description?: string
  /** The exact query or thread that produced this, for the reviewer. */
  discoveredVia?: string
  /**
   * Phrases in the thread that bear on the field spec, e.g. "full field",
   * "we have an FMS", "AndyMark game pieces". These are EVIDENCE for a human
   * to read, never a parsed value, because the thread may be describing
   * somebody else's field.
   */
  signals?: string[]
  /** The literal strings a parse keyed off, e.g. the "Team 3538" that became a number. */
  evidence?: string[]
  /** Outbound links found in the thread, in the order they appeared. */
  links?: string[]

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
 * Deterministically read fields, shaped to drop onto a practice_fields row.
 * Short by design: a forum post gives a team, a link and some prose, and
 * everything a team actually needs to decide (address, hours, who to ask) is
 * prose a person has to read.
 */
export interface ExtractedPracticeFieldFields {
  /** Facility name, only when the thread gave one that is not just the title. */
  name?: string
  teamNumber?: number
  teamName?: string
  /** FIELD_PROGRAMS. Left undefined when the thread did not say. */
  program?: string
  city?: string
  region?: string
  country?: string
  website?: string
  /** A sign-up / booking form linked in the thread. */
  contactUrl?: string

  // Read by the model, each one backed by a quote from the thread or a page it
  // opened. The deterministic connector refuses to parse these, and it is right
  // to: "full field" in a thread may describe what the poster WANTS. A reader
  // that understands the sentence can tell, and the quote is kept so a
  // moderator can check the sentence rather than trust the label.
  address?: string
  /** Free text as the poster wrote it: "Mon/Wed 5:30-8:30 during offseason". */
  hours?: string
  /** FIELD_AVAILABILITY. */
  availability?: string
  /** FIELD_COVERAGE. */
  coverage?: string
  /** FIELD_PERIMETER. */
  perimeter?: string
  /** FIELD_ELEMENTS. */
  elements?: string
  hasFms?: boolean
  ceilingHeightFt?: number
  /** Looked up from a real street address only. See the events note. */
  latitude?: number
  longitude?: number
  /** An email address or "ask for Dave in the FiM Discord". */
  contactInfo?: string
  notes?: string
}
