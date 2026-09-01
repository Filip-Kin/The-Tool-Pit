import { pgTable, uuid, text, integer, real, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { grants } from './grants'
import { users } from './accounts'

// ---------------------------------------------------------------------------
// Grant discovery and monitoring
//
// Two different jobs share these tables, and it is worth keeping them apart in
// your head:
//
//   MONITOR  - we already know this grant. Re-fetch its page on a cadence and
//              notice when the deadline, the amount or the eligibility moves.
//              Deterministic first: hash the stripped content, and only spend
//              an AI extraction when the hash actually changed.
//
//   DISCOVER - we do NOT know this grant yet. Sweep several unrelated angles
//              (web search, Chief Delphi, team sponsor pages, aggregator docs,
//              manual submissions) because no single angle finds everything.
//              Everything lands as a candidate a human approves.
//
// The tools vertical auto-published its crawl output and filled up with forum
// threads and bot walls. Grants gate. Nothing here goes public unreviewed.
// ---------------------------------------------------------------------------

export const grantSources = pgTable(
  'grant_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** GRANT_SOURCE_KINDS */
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    /** Page to crawl, or the query string for a `web_search` source. */
    target: text('target').notNull(),
    /**
     * Connector-specific settings: the CSS selector holding the main content,
     * a region to scope search results to, a list of team numbers to sweep.
     */
    config: jsonb('config').$type<Record<string, unknown>>(),
    enabled: boolean('enabled').notNull().default(true),
    cadenceHours: integer('cadence_hours').notNull().default(168),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** Rolling count of candidates this source has produced that got published. */
    yieldCount: integer('yield_count').notNull().default(0),
    /** Rolling count of candidates a human suppressed. High = a noisy source. */
    rejectCount: integer('reject_count').notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('grant_sources_kind_idx').on(table.kind),
    index('grant_sources_enabled_idx').on(table.enabled),
  ],
)

export const grantCrawlJobs = pgTable(
  'grant_crawl_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => grantSources.id, { onDelete: 'set null' }),
    /** Connector name, e.g. `grant_seed`, `grant_web_search`, `grant_sponsors`. */
    connector: text('connector').notNull(),
    /** queued | running | done | failed */
    status: text('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    stats: jsonb('stats').$type<GrantCrawlStats>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('grant_crawl_jobs_connector_idx').on(table.connector),
    index('grant_crawl_jobs_status_idx').on(table.status),
    index('grant_crawl_jobs_created_at_idx').on(table.createdAt),
  ],
)

// ---------------------------------------------------------------------------
// Candidates (DISCOVER output)
// ---------------------------------------------------------------------------

export const grantCandidates = pgTable(
  'grant_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').references(() => grantCrawlJobs.id, { onDelete: 'set null' }),
    sourceId: uuid('source_id').references(() => grantSources.id, { onDelete: 'set null' }),
    sourceUrl: text('source_url').notNull(),
    /** Deduped on this: scheme+host+path, tracking parameters stripped. */
    canonicalUrl: text('canonical_url'),
    rawMetadata: jsonb('raw_metadata').$type<RawGrantMetadata>(),
    classification: jsonb('classification').$type<GrantClassification>(),
    confidenceScore: real('confidence_score'),
    /** pending | matched | published | suppressed | duplicate */
    status: text('status').notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    matchedGrantId: uuid('matched_grant_id').references(() => grants.id, { onDelete: 'set null' }),

    // Submitter audit for kind='submission' (private, admin only).
    submitterName: text('submitter_name'),
    submitterContact: text('submitter_contact'),
    submitterIpHash: text('submitter_ip_hash'),
    /**
     * The signed-in user who submitted this, when there was one. Sign-in is
     * OPTIONAL here on purpose: an anonymous submission still goes through, so
     * a mentor without an account is never turned away. Signing in buys
     * attribution and, since approval emails, an answer when it is reviewed.
     * NULL therefore means "nobody to tell", and that is the whole check.
     */
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('grant_candidates_job_idx').on(table.jobId),
    index('grant_candidates_submitted_by_idx').on(table.submittedByUserId),
    index('grant_candidates_status_idx').on(table.status),
    index('grant_candidates_canonical_url_idx').on(table.canonicalUrl),
  ],
)

// ---------------------------------------------------------------------------
// Snapshots (MONITOR history)
//
// One row per fetch of one URL. `contentHash` is taken AFTER stripping nav,
// footer, cookie banners and anything else that changes on every request -
// without that strip every page looks changed on every pass and the AI bill
// is the whole point of the exercise.
// ---------------------------------------------------------------------------

export const grantSnapshots = pgTable(
  'grant_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grantId: uuid('grant_id').references(() => grants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    httpStatus: integer('http_status'),
    /** Hash of the boilerplate-stripped main content. */
    contentHash: text('content_hash'),
    /** Stripped text, truncated. Kept so a diff can be shown to a reviewer. */
    contentText: text('content_text'),
    /** Structured fields the extractor read out of this fetch. */
    extracted: jsonb('extracted').$type<ExtractedGrantFields>(),
    /** False when the hash matched the previous fetch (no extraction ran). */
    changed: boolean('changed').notNull().default(false),
    error: text('error'),
  },
  (table) => [
    index('grant_snapshots_grant_idx').on(table.grantId),
    index('grant_snapshots_url_idx').on(table.url),
    index('grant_snapshots_fetched_at_idx').on(table.fetchedAt),
  ],
)

// ---------------------------------------------------------------------------
// Changes
//
// The review queue that makes a moving deadline safe. A crawl NEVER writes a
// new deadline straight onto a published grant; it files a change here and an
// admin applies or dismisses it. Auto-apply is allowed only for the narrow
// case flagged by `autoApplicable` (a new future cycle appearing on a grant
// that had no cycle for that year at all), and even that is logged.
// ---------------------------------------------------------------------------

export const grantChanges = pgTable(
  'grant_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id').references(() => grantSnapshots.id, { onDelete: 'set null' }),
    /** Dotted path of what moved, e.g. `cycle.2027.deadlineAt`, `awardMax`. */
    field: text('field').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    /** Extractor's own words on why it thinks this changed. */
    reasoning: text('reasoning'),
    /** True only for a strictly-additive new cycle. Everything else is manual. */
    autoApplicable: boolean('auto_applicable').notNull().default(false),
    /** pending | applied | dismissed */
    status: text('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('grant_changes_grant_idx').on(table.grantId),
    index('grant_changes_status_idx').on(table.status),
  ],
)

// ---------------------------------------------------------------------------
// Sponsor mentions (DISCOVER signal)
//
// Teams list who funds them. A funder name appearing on several unrelated team
// sponsor pages is strong evidence it gives money to robotics teams, even when
// no grant page has been found yet. This is a free signal - team websites come
// from TBA, which is already synced for the photos vertical.
// ---------------------------------------------------------------------------

export const grantSponsorMentions = pgTable(
  'grant_sponsor_mentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Normalised funder name, lowercased and punctuation-stripped, for grouping. */
    funderKey: text('funder_key').notNull(),
    /** The name as it appeared on the page. */
    rawName: text('raw_name').notNull(),
    program: text('program').notNull().default('frc'),
    teamNumber: integer('team_number'),
    /** The team page it was found on. */
    sourceUrl: text('source_url').notNull(),
    /** Outbound link next to the name, when there was one. */
    funderUrl: text('funder_url'),
    /** Set once this mention has been rolled into a grant_funders row. */
    resolvedFunderId: uuid('resolved_funder_id'),
    /** Set when a human decided this name is not a fundable source. */
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('grant_sponsor_mentions_key_team_idx').on(table.funderKey, table.program, table.teamNumber),
    index('grant_sponsor_mentions_key_idx').on(table.funderKey),
  ],
)

export const grantSourcesRelations = relations(grantSources, ({ many }) => ({
  jobs: many(grantCrawlJobs),
  candidates: many(grantCandidates),
}))

export const grantCrawlJobsRelations = relations(grantCrawlJobs, ({ one, many }) => ({
  source: one(grantSources, { fields: [grantCrawlJobs.sourceId], references: [grantSources.id] }),
  candidates: many(grantCandidates),
}))

export const grantCandidatesRelations = relations(grantCandidates, ({ one }) => ({
  job: one(grantCrawlJobs, { fields: [grantCandidates.jobId], references: [grantCrawlJobs.id] }),
  source: one(grantSources, { fields: [grantCandidates.sourceId], references: [grantSources.id] }),
  matchedGrant: one(grants, { fields: [grantCandidates.matchedGrantId], references: [grants.id] }),
}))

export const grantSnapshotsRelations = relations(grantSnapshots, ({ one }) => ({
  grant: one(grants, { fields: [grantSnapshots.grantId], references: [grants.id] }),
}))

export const grantChangesRelations = relations(grantChanges, ({ one }) => ({
  grant: one(grants, { fields: [grantChanges.grantId], references: [grants.id] }),
  snapshot: one(grantSnapshots, { fields: [grantChanges.snapshotId], references: [grantSnapshots.id] }),
}))

export type GrantSource = typeof grantSources.$inferSelect
export type NewGrantSource = typeof grantSources.$inferInsert
export type GrantCrawlJob = typeof grantCrawlJobs.$inferSelect
export type NewGrantCrawlJob = typeof grantCrawlJobs.$inferInsert
export type GrantCandidate = typeof grantCandidates.$inferSelect
export type NewGrantCandidate = typeof grantCandidates.$inferInsert
export type GrantSnapshot = typeof grantSnapshots.$inferSelect
export type NewGrantSnapshot = typeof grantSnapshots.$inferInsert
export type GrantChange = typeof grantChanges.$inferSelect
export type NewGrantChange = typeof grantChanges.$inferInsert
export type GrantSponsorMention = typeof grantSponsorMentions.$inferSelect
export type NewGrantSponsorMention = typeof grantSponsorMentions.$inferInsert

export interface GrantCrawlStats {
  discovered: number
  new: number
  updated: number
  unchanged: number
  skipped: number
  failed: number
}

export interface RawGrantMetadata {
  title?: string
  description?: string
  ogDescription?: string
  funderName?: string
  applicationUrl?: string
  /** The search query or thread that surfaced this, for the audit trail. */
  discoveredVia?: string
  /** Truncated stripped page text handed to the classifier. */
  contentText?: string
}

/**
 * Classifier output. The question it must answer is "is this a grant a
 * robotics team can APPLY for", not "is this page about robotics" - scoring
 * relatedness instead of applicability is exactly what filled the tools
 * directory with forum threads.
 */
export interface GrantClassification {
  isGrant?: boolean
  /** True for a sponsorship logo, a news story, a past-tense award announcement. */
  isAnnouncement?: boolean
  /** True when the page is a list of grants rather than one grant. */
  isAggregator?: boolean
  name?: string
  funderName?: string
  summary?: string
  programs?: string[]
  geoScope?: string
  countries?: string[]
  regions?: string[]
  awardMin?: number | null
  awardMax?: number | null
  deadlineType?: string
  confidence?: number
  reasoning?: string
}

/** Structured fields the extractor reads off one fetch, used for diffing. */
export interface ExtractedGrantFields {
  deadlineAt?: string | null
  deadlineNote?: string | null
  opensAt?: string | null
  cycleYear?: number | null
  awardMin?: number | null
  awardMax?: number | null
  awardNotes?: string | null
  eligibilityText?: string | null
  applicationUrl?: string | null
  /** True when the page says the round is shut. */
  looksClosed?: boolean
}
