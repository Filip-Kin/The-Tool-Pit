import { pgTable, uuid, text, integer, real, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { grants } from './grants'
import { users } from './accounts'
import type { GrantApplyMethod, GrantEvidenceSource, GrantTriState } from '../grant-enums'

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
    /**
     * The extraction pass output: every field a moderator would otherwise
     * type, each with the verbatim quote that supports it and which text that
     * quote was found in. Written by the second pass, never published by it.
     * See GrantExtraction at the bottom of this file.
     */
    extraction: jsonb('extraction').$type<GrantExtraction>(),
    /** When the extraction pass last ran. Null = it has not run on this row. */
    extractedAt: timestamp('extracted_at', { withTimezone: true }),
    confidenceScore: real('confidence_score'),
    /** GRANT_CANDIDATE_STATUSES */
    status: text('status').notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    /**
     * GRANT_REJECTION_KINDS. The bucket a moderator put the rejection in.
     *
     * rejectionReason is one person's sentence about one page, which is the
     * right thing to show a submitter and the wrong thing to feed a model.
     * This column is the machine-readable half: recent suppressions grouped by
     * kind become the classifier's negative examples, so a page shape that
     * keeps getting through gets caught next time instead of being rejected
     * again by hand.
     */
    rejectionKind: text('rejection_kind'),
    /**
     * Why a moderator flagged the row for better data. Flagging is not a
     * rejection, so it does not touch rejectionReason: the candidate stays in
     * the queue and this note tells the deep re-extraction what was wrong.
     */
    reviewNote: text('review_note'),
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
    /**
     * Did the submitter say this is theirs to run?
     *
     * TRUE  - they left the "I am only passing this along" box unticked, so
     *         approving this grants them the listing. See
     *         apps/web/lib/listings/submitter-ownership.ts.
     * FALSE - they ticked it. Nothing is granted, ever, from this row.
     * NULL  - submitted before the form asked. Not a refusal, just never asked,
     *         so the claim page still reads their submission as evidence.
     */
    submitterOwns: boolean('submitter_owns'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('grant_candidates_job_idx').on(table.jobId),
    index('grant_candidates_submitted_by_idx').on(table.submittedByUserId),
    index('grant_candidates_status_idx').on(table.status),
    index('grant_candidates_rejection_kind_idx').on(table.rejectionKind),
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

// ---------------------------------------------------------------------------
// Extraction (the second pass over an accepted candidate)
//
// Classification answers "is this a grant". Extraction fills the record. They
// are separate calls on purpose: a classifier that also extracts is a
// classifier that invents a deadline to fill a field, and grants exist
// downstream of that exact lesson.
//
// Two rules shape everything below.
//
//   1. Tri-state, never a bare null. Every yes/no answer is yes | no |
//      unknown. A blank used to mean both "the page says no" and "the page did
//      not say", and a team reading the listing could not tell which.
//   2. Every value carries the verbatim quote that supports it, and which text
//      that quote was found in. A field with no supporting quote comes back
//      unknown rather than guessed. listing-ownership.ts states the rule this
//      serves: a grant's dates, amounts and eligibility are a moderator's
//      verified reading of the funder's page, and a wrong deadline is worse
//      than no deadline.
// ---------------------------------------------------------------------------

/**
 * One extracted value with its evidence.
 *
 * `value === null` means the page did not state it. For a tri-state field the
 * "did not state" answer is the value 'unknown', so those are never null.
 */
export interface ExtractedField<T> {
  value: T | null
  /** Verbatim from the evidence text, trimmed. Null when nothing supported it. */
  quote: string | null
  /** Which text `quote` was verified against. Null when there is no quote. */
  source: GrantEvidenceSource | null
  /**
   * Set when the funder's page and the aggregator blurb disagree. The value
   * kept is the funder's page, because it is the one that can be applied on,
   * but the disagreement is shown to the moderator rather than swallowed.
   */
  conflict?: string | null
}

/**
 * Every field the extraction pass attempts. All of them are present on a
 * completed extraction, so "the pass did not look" and "the page did not say"
 * cannot be confused: the first is a missing key, the second is a null value
 * or 'unknown' with a reason.
 */
export interface GrantExtractionFields {
  // --- Identity and prose ---
  name: ExtractedField<string>
  funderName: ExtractedField<string>
  /** One or two sentences. The card on the public list. */
  summary: ExtractedField<string>
  /** Several paragraphs. Longer than the summary, for the detail page. */
  description: ExtractedField<string>

  // --- How to apply ---
  /** GRANT_APPLY_METHODS. */
  applyMethod: ExtractedField<GrantApplyMethod>
  applicationUrl: ExtractedField<string>
  contactEmail: ExtractedField<string>
  mailingAddress: ExtractedField<string>

  // --- Money ---
  awardMin: ExtractedField<number>
  awardMax: ExtractedField<number>
  awardCurrency: ExtractedField<string>
  /**
   * The funder's own words about the amount, verbatim.
   *
   * This is the field that fixes an 11% award fill rate. awardMin and awardMax
   * are integers, so "varies", "up to $5,000 in kind" and "typically $500 to
   * $2,000 per team" all stored as NULL and the listing said nothing at all.
   * The integers stay where a real figure exists; the phrase is what a team
   * reads when there is not one.
   */
  awardPhrase: ExtractedField<string>
  /** GRANT_TRI_STATES. Can a team apply again in a later cycle. */
  renewable: ExtractedField<GrantTriState>
  /** GRANT_EFFORT_LEVELS. Rough size of the application. */
  effortLevel: ExtractedField<string>

  // --- Geography ---
  /** GRANT_GEO_SCOPES. */
  geoScope: ExtractedField<string>
  /** ISO 3166-1 alpha-2. */
  countries: ExtractedField<string[]>
  /** State or province codes. */
  regions: ExtractedField<string[]>
  /** A county or metro with no code of its own. */
  localityNote: ExtractedField<string>

  // --- Timing. Lands in grant_cycles, not on the grant. ---
  /** GRANT_DEADLINE_TYPES. */
  deadlineType: ExtractedField<string>
  /** Calendar year the round closes in. */
  cycleYear: ExtractedField<number>
  /** YYYY-MM-DD. */
  opensAt: ExtractedField<string>
  /** ISO instant with an offset when the page gives a time and zone, else YYYY-MM-DD. */
  deadlineAt: ExtractedField<string>
  /** The funder's own wording, e.g. "11:59pm Eastern". */
  deadlineNote: ExtractedField<string>
  /** YYYY-MM-DD, when decisions are announced. */
  decisionAt: ExtractedField<string>

  // --- Eligibility. The tri-states land in grant_requirements. ---
  requires501c3: ExtractedField<GrantTriState>
  /** Does an employee or member of the funder have to mentor or sponsor the team. */
  requiresEmployeeMentor: ExtractedField<GrantTriState>
  rookieOnly: ExtractedField<GrantTriState>
  /** Must the team be a school team or attached to a school. */
  requiresSchoolAffiliation: ExtractedField<GrantTriState>
  /** e.g. "grades 6-12", "under 18". */
  ageRange: ExtractedField<string>
  /** Eligibility geography in the funder's words, beside the coded regions. */
  geographyRestriction: ExtractedField<string>
  /** Everything else about who may apply, in plain words. */
  eligibilityText: ExtractedField<string>
  /** GRANT_PROGRAMS. */
  programs: ExtractedField<string[]>
}

/** The stored extraction. Written to grant_candidates.extraction. */
export interface GrantExtraction {
  /** Bumped when the field set changes, so an old row is readable as old. */
  version: number
  fields: GrantExtractionFields
  /** Model id, so a bad batch can be found later. */
  model?: string
  /** 'shallow' = the page we already had. 'deep' = refetched and widened. */
  depth: 'shallow' | 'deep'
  /** Every URL whose text was read, in the order it was read. */
  evidenceUrls: string[]
  /** Quotes dropped because they were in neither text, truncation, skipped surfaces. */
  notes: string[]
  /** The model's own sentence on what it could and could not read. */
  reasoning?: string
  extractedAt: string
}
