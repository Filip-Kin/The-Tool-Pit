import { pgTable, uuid, text, real, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { tools } from './tools'

// ---------------------------------------------------------------------------
// Crawl job tracking
// ---------------------------------------------------------------------------

export const crawlJobs = pgTable(
  'crawl_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Which connector ran this job:
     * fta_tools | volunteer_systems | github | chief_delphi | official_first | manual
     */
    connector: text('connector').notNull(),
    /**
     * queued | running | done | failed
     */
    status: text('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Counts: discovered, new, updated, skipped, failed */
    stats: jsonb('stats').$type<CrawlStats>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('crawl_jobs_connector_idx').on(table.connector),
    index('crawl_jobs_status_idx').on(table.status),
    index('crawl_jobs_created_at_idx').on(table.createdAt),
  ],
)

// ---------------------------------------------------------------------------
// Pre-canonicalization candidates
// ---------------------------------------------------------------------------

export const crawlCandidates = pgTable(
  'crawl_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').references(() => crawlJobs.id, { onDelete: 'set null' }),
    sourceUrl: text('source_url').notNull(),
    canonicalUrl: text('canonical_url'),
    /** Raw data extracted from the page / source */
    rawMetadata: jsonb('raw_metadata').$type<RawCandidateMetadata>(),
    /** Output from AI classification stage */
    classification: jsonb('classification').$type<CandidateClassification>(),
    confidenceScore: real('confidence_score'),
    /**
     * pending | matched | merged | published | suppressed | duplicate
     */
    status: text('status').notNull().default('pending'),
    matchedToolId: uuid('matched_tool_id').references(() => tools.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('crawl_candidates_job_id_idx').on(table.jobId),
    index('crawl_candidates_status_idx').on(table.status),
    index('crawl_candidates_canonical_url_idx').on(table.canonicalUrl),
  ],
)

export const crawlJobsRelations = relations(crawlJobs, ({ many }) => ({
  candidates: many(crawlCandidates),
}))

export const crawlCandidatesRelations = relations(crawlCandidates, ({ one }) => ({
  job: one(crawlJobs, { fields: [crawlCandidates.jobId], references: [crawlJobs.id] }),
  matchedTool: one(tools, {
    fields: [crawlCandidates.matchedToolId],
    references: [tools.id],
  }),
}))

export type CrawlJob = typeof crawlJobs.$inferSelect
export type NewCrawlJob = typeof crawlJobs.$inferInsert
export type CrawlCandidate = typeof crawlCandidates.$inferSelect
export type NewCrawlCandidate = typeof crawlCandidates.$inferInsert

export interface CrawlStats {
  discovered: number
  new: number
  updated: number
  skipped: number
  failed: number
}

export interface RawCandidateMetadata {
  title?: string
  description?: string
  ogDescription?: string
  githubUrl?: string
  homepageUrl?: string
  docsUrl?: string
  keywords?: string[]
  rawHtml?: string // truncated
}

export interface CandidateClassification {
  toolType?: string
  programs?: string[]
  audienceRoles?: string[]
  audienceFunctions?: string[]
  isRookieFriendly?: boolean
  isOfficial?: boolean
  isVendor?: boolean
  isTeamCode?: boolean
  teamNumber?: number | null
  seasonYear?: number | null
  summary?: string
  confidence?: number
  reasoning?: string
}
