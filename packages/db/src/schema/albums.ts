import { pgTable, uuid, text, boolean, integer, real, timestamp, jsonb, index, unique, customType } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { events } from './events'
import { users } from './accounts'
import type { PipelineLogEntry } from './submissions'

/** Raw binary column (Postgres bytea) for manually-uploaded cover images. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

// ---------------------------------------------------------------------------
// Enum-like value tuples (plain text columns, app-level unions - no pgEnum)
// ---------------------------------------------------------------------------

export const ALBUM_PROVIDERS = [
  'smugmug',
  'flickr',
  'google_photos',
  'google_drive',
  'dropbox',
  'pixieset',
  'chief_delphi',
  'firstinmichigan',
  'other',
] as const
export type AlbumProvider = (typeof ALBUM_PROVIDERS)[number]

/**
 * HOW an album reached us, which is not the same question as who hosts it.
 *
 * ALBUM_PROVIDERS above answers the hosting question, and the two tuples share
 * six values, which is why they got confused: the publish path fell back to the
 * provider whenever it had no mapping for the connector, and wrote whatever it
 * found. `google_drive` is a provider and not a source type, and production
 * holds one album with source_type = 'google_drive' today, with 30 more
 * google_drive candidates, one dropbox and four `other` queued behind it.
 *
 * Adding 'toa' because The Orange Alliance is a real connector that had no
 * source type at all, so its albums took the provider fallback too.
 */
export const ALBUM_SOURCE_TYPES = [
  'firstinmichigan',
  'chief_delphi',
  'smugmug',
  'flickr',
  'google_photos',
  'pixieset',
  'manual',
  'tba',
  'toa',
] as const
export type AlbumSourceType = (typeof ALBUM_SOURCE_TYPES)[number]

export const ALBUM_STATUSES = ['draft', 'published', 'suppressed'] as const
export type AlbumStatus = (typeof ALBUM_STATUSES)[number]

export const ALBUM_CANDIDATE_STATUSES = ['pending', 'matched', 'published', 'suppressed', 'duplicate'] as const
export type AlbumCandidateStatus = (typeof ALBUM_CANDIDATE_STATUSES)[number]

export const ALBUM_SUBMISSION_STATUSES = [
  'pending',
  'processing',
  'published',
  'duplicate',
  'rejected',
  'needs_review',
] as const
export type AlbumSubmissionStatus = (typeof ALBUM_SUBMISSION_STATUSES)[number]

export const ALBUM_CRAWL_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export type AlbumCrawlStatus = (typeof ALBUM_CRAWL_STATUSES)[number]

// ---------------------------------------------------------------------------
// Published album records
// ---------------------------------------------------------------------------

export const albums = pgTable(
  'albums',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** Normalized URL used for dedup. Unique across all albums. */
    canonicalUrl: text('canonical_url').notNull(),
    /** ALBUM_PROVIDERS */
    provider: text('provider').notNull().default('other'),
    /** ALBUM_SOURCE_TYPES - how this album was discovered */
    sourceType: text('source_type').notNull(),
    title: text('title'),
    photographer: text('photographer'),
    description: text('description'),
    /** Human date/date-range shown on the album (e.g. "Apr 12-14"). */
    dateText: text('date_text'),
    coverImageUrl: text('cover_image_url'),
    photoCount: integer('photo_count'),
    /** ALBUM_STATUSES */
    status: text('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('albums_canonical_url_uq').on(table.canonicalUrl),
    index('albums_event_id_idx').on(table.eventId),
    index('albums_status_idx').on(table.status),
    index('albums_provider_idx').on(table.provider),
  ],
)

// ---------------------------------------------------------------------------
// Manually-uploaded cover images (fallback for hosts with no usable og:image:
// Google Drive / Dropbox folders, IP-blocked Flickr). Stored in-DB and served
// via /api/albums/cover/[id]; the album's cover_image_url points at that route.
// ---------------------------------------------------------------------------

export const albumCovers = pgTable('album_covers', {
  albumId: uuid('album_id')
    .primaryKey()
    .references(() => albums.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  data: bytea('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Source evidence: where/how an album was discovered or confirmed
// ---------------------------------------------------------------------------

export const albumSources = pgTable(
  'album_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    albumId: uuid('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    /** ALBUM_SOURCE_TYPES */
    sourceType: text('source_type').notNull(),
    /** FiM event page, CD thread, or submission origin URL */
    sourceUrl: text('source_url'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    rawMetadata: jsonb('raw_metadata'),
    notes: text('notes'),
  },
  (table) => [
    index('album_sources_album_id_idx').on(table.albumId),
    index('album_sources_type_idx').on(table.sourceType),
  ],
)

// ---------------------------------------------------------------------------
// Album crawl job tracking
// ---------------------------------------------------------------------------

export const albumCrawlJobs = pgTable(
  'album_crawl_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** tba_events | fim_albums | chief_delphi_albums | manual */
    connector: text('connector').notNull(),
    /** ALBUM_CRAWL_STATUSES */
    status: text('status').notNull().default('queued'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    stats: jsonb('stats').$type<AlbumCrawlStats>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('album_crawl_jobs_connector_idx').on(table.connector),
    index('album_crawl_jobs_status_idx').on(table.status),
    index('album_crawl_jobs_created_at_idx').on(table.createdAt),
  ],
)

// ---------------------------------------------------------------------------
// Album candidates - moderation staging (scraped, CD, and submitted)
// ---------------------------------------------------------------------------

export const albumCandidates = pgTable(
  'album_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').references(() => albumCrawlJobs.id, { onDelete: 'set null' }),
    sourceUrl: text('source_url').notNull(),
    canonicalUrl: text('canonical_url'),
    /** ALBUM_PROVIDERS */
    provider: text('provider'),
    /** Intended event carried through the pipeline until matched */
    targetEventCode: text('target_event_code'),
    targetEventYear: integer('target_event_year'),
    matchedEventId: uuid('matched_event_id').references(() => events.id, { onDelete: 'set null' }),
    rawMetadata: jsonb('raw_metadata').$type<AlbumCandidateMetadata>(),
    /** Output of the event-match step (heuristic or AI) */
    classification: jsonb('classification').$type<AlbumEventMatch>(),
    confidenceScore: real('confidence_score'),
    /** ALBUM_CANDIDATE_STATUSES */
    status: text('status').notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    /** Originating submission if created from a manual submission */
    submissionId: uuid('submission_id'),
    matchedAlbumId: uuid('matched_album_id').references(() => albums.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('album_candidates_job_id_idx').on(table.jobId),
    index('album_candidates_status_idx').on(table.status),
    index('album_candidates_canonical_url_idx').on(table.canonicalUrl),
    index('album_candidates_target_event_code_idx').on(table.targetEventCode),
    index('album_candidates_submission_id_idx').on(table.submissionId),
  ],
)

// ---------------------------------------------------------------------------
// Public manual submissions
// ---------------------------------------------------------------------------

export const albumSubmissions = pgTable(
  'album_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    url: text('url').notNull(),
    /** User-typed event code or name */
    eventHint: text('event_hint'),
    photographerHint: text('photographer_hint'),
    submitterNote: text('submitter_note'),
    submitterIpHash: text('submitter_ip_hash'),
    /** ALBUM_SUBMISSION_STATUSES */
    status: text('status').notNull().default('pending'),
    resolvedAlbumId: uuid('resolved_album_id').references(() => albums.id, { onDelete: 'set null' }),
    pipelineLog: jsonb('pipeline_log').$type<PipelineLogEntry[]>(),
    confidenceScore: real('confidence_score'),
    spamScore: real('spam_score'),
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
    index('album_submissions_status_idx').on(table.status),
    index('album_submissions_submitted_by_idx').on(table.submittedByUserId),
    index('album_submissions_created_at_idx').on(table.createdAt),
  ],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const albumsRelations = relations(albums, ({ one, many }) => ({
  event: one(events, { fields: [albums.eventId], references: [events.id] }),
  sources: many(albumSources),
}))

export const albumSourcesRelations = relations(albumSources, ({ one }) => ({
  album: one(albums, { fields: [albumSources.albumId], references: [albums.id] }),
}))

export const albumCrawlJobsRelations = relations(albumCrawlJobs, ({ many }) => ({
  candidates: many(albumCandidates),
}))

export const albumCandidatesRelations = relations(albumCandidates, ({ one }) => ({
  job: one(albumCrawlJobs, { fields: [albumCandidates.jobId], references: [albumCrawlJobs.id] }),
  matchedEvent: one(events, { fields: [albumCandidates.matchedEventId], references: [events.id] }),
  matchedAlbum: one(albums, { fields: [albumCandidates.matchedAlbumId], references: [albums.id] }),
}))

export const albumSubmissionsRelations = relations(albumSubmissions, ({ one }) => ({
  resolvedAlbum: one(albums, { fields: [albumSubmissions.resolvedAlbumId], references: [albums.id] }),
}))

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Album = typeof albums.$inferSelect
export type NewAlbum = typeof albums.$inferInsert
export type AlbumCover = typeof albumCovers.$inferSelect
export type NewAlbumCover = typeof albumCovers.$inferInsert
export type AlbumSource = typeof albumSources.$inferSelect
export type NewAlbumSource = typeof albumSources.$inferInsert
export type AlbumCrawlJob = typeof albumCrawlJobs.$inferSelect
export type NewAlbumCrawlJob = typeof albumCrawlJobs.$inferInsert
export type AlbumCandidate = typeof albumCandidates.$inferSelect
export type NewAlbumCandidate = typeof albumCandidates.$inferInsert
export type AlbumSubmission = typeof albumSubmissions.$inferSelect
export type NewAlbumSubmission = typeof albumSubmissions.$inferInsert

export interface AlbumCrawlStats {
  discovered: number
  new: number
  matched: number
  skipped: number
  failed: number
  /** For tba_events: number of events / event_teams rows upserted */
  eventsUpserted?: number
  eventTeamsUpserted?: number
}

export interface AlbumCandidateMetadata {
  title?: string
  photographer?: string
  description?: string
  /** Human date/date-range parsed from the album title/description. */
  dateText?: string
  coverImageUrl?: string
  host?: string
  /**
   * FIRST program (frc/ftc/fll) the album belongs to, when the source makes it
   * unambiguous (e.g. a SmugMug "FIRST Robotics Competition" folder). Constrains
   * event matching so an FRC album can't match an FTC event of the same year.
   */
  targetProgram?: 'frc' | 'ftc' | 'fll'
  /** CD-specific */
  threadUrl?: string
  threadTitle?: string
  blurb?: string
}

export interface AlbumEventMatch {
  eventCode?: string | null
  confidence?: number
  method: 'exact_code' | 'name_match' | 'ai' | 'none'
  reasoning?: string
}
