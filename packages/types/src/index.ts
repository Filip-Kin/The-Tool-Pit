/**
 * Shared types used by both apps/web and apps/worker.
 *
 * Almost everything here is a pure TypeScript type with no runtime cost. The
 * one exception is ./email, which is pure string building with no imports of
 * its own: it lives here because both apps send the same mail and a template
 * kept in one app has to be copied into the other, which is how the two grant
 * alert copies drifted.
 *
 * ./discord is here for exactly that reason. It used to be five copies, one per
 * vertical, in apps/web, and one of them had been posting to a deleted webhook
 * for months without saying so.
 */

export * from './email/index'
export * from './discord/index'

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type SearchSort = 'relevance' | 'popular' | 'newest' | 'updated'

export interface SearchParams {
  query: string
  program?: 'frc' | 'ftc' | 'fll'
  toolType?: string
  audienceRole?: string
  audienceFunction?: string
  isOfficial?: boolean
  isVendor?: boolean
  isRookieFriendly?: boolean
  isTeamCode?: boolean
  isTeamCad?: boolean
  /** Match team code OR team CAD (the Robot Code Archive lists both). */
  teamArtifact?: boolean
  teamNumber?: number
  seasonYear?: number
  sort?: SearchSort
  page?: number
  pageSize?: number
}

export interface SearchResult {
  id: string
  slug: string
  name: string
  summary: string | null
  toolType: string
  isOfficial: boolean
  isVendor: boolean
  isRookieFriendly: boolean
  isTeamCode: boolean
  teamNumber: number | null
  seasonYear: number | null
  programs: string[] // program slugs
  githubUrl: string | null
  publicFreshnessLabel: 'Current' | 'Stale' | 'Abandoned' | null
  lastActivityAt: string | null
  popularityScore: number
  voteCount: number
  /** Ranking score (higher = better) - not exposed to UI */
  _score?: number
}

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

export interface VoteRequest {
  toolId: string
  action: 'toggle'
}

export interface VoteResponse {
  voted: boolean
  voteCount: number
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmitToolRequest {
  url: string
  note?: string
}

export interface SubmitToolResponse {
  submissionId: string
  status: 'pending' | 'published' | 'duplicate' | 'rejected'
  message: string
  toolSlug?: string // if auto-published
}

// ---------------------------------------------------------------------------
// Worker queue job payloads
// ---------------------------------------------------------------------------

export interface CrawlJobPayload {
  connector: string
  jobId: string
  options?: Record<string, unknown>
}

export interface EnrichJobPayload {
  candidateId: string
  toolId?: string
  /** When set, the submission record is updated after the pipeline decides. */
  submissionId?: string
  /** Connector name that produced this candidate (e.g. 'fta_tools', 'github_topics'). */
  sourceType?: string
  /** When true, re-fetches the candidate URL before classifying (picks up rawHtml etc). */
  rescrape?: boolean
}

export interface FreshnessCheckPayload {
  toolId: string
}

export interface ReindexPayload {
  toolId?: string // if undefined, reindex all published tools
}

export interface SubmissionJobPayload {
  submissionId: string
}

export interface LinkCheckPayload {
  toolId: string
}

/** Shape of the stats object stored in crawl_jobs.stats */
export interface CrawlJobStats {
  discovered?: number
  new?: number
  updated?: number
  skipped?: number
  failed?: number
  errors?: number
}

// ---------------------------------------------------------------------------
// Photo album aggregator - worker queue job payloads
// ---------------------------------------------------------------------------

export interface AlbumIngestPayload {
  /** tba_events | fim_albums | chief_delphi_albums */
  connector: string
  /** Season year for tba_events / fim_albums. Defaults to current season. */
  year?: number
  jobId?: string
  options?: Record<string, unknown>
}

export interface AlbumEnrichPayload {
  candidateId: string
  /** When set, the album_submissions record is updated after the pipeline decides. */
  submissionId?: string
  /** When true, re-fetches the album URL for OG metadata before matching. */
  rescrape?: boolean
}

// ---------------------------------------------------------------------------
// Photo album aggregator - public DTOs
// ---------------------------------------------------------------------------

export interface AlbumSearchParams {
  query: string
  year?: number
  page?: number
  pageSize?: number
}

export interface EventSearchResult {
  id: string
  tbaKey: string
  eventCode: string
  name: string
  year: number
  startDate: string | null
  endDate: string | null
  week: number | null
  /** TBA event_type int (99 = offseason, 100 = preseason). */
  eventType: number | null
  city: string | null
  stateProv: string | null
  country: string | null
  albumCount: number
  /** Cover images of the first few published albums, for previews. */
  coverImages: string[]
  /**
   * If the event has exactly one published album, its external URL - so cards
   * and suggestions can link straight to it instead of an event page with a
   * single item.
   */
  soleAlbumUrl?: string | null
  /**
   * That same album's id.
   *
   * Linking straight out means a one-album event never shows an album card,
   * and roughly two thirds of events have exactly one album, so without this
   * most photographers had no card to claim their album from. The event card
   * carries the album's own menu instead, and this is what it needs to say
   * which album it means.
   */
  soleAlbumId?: string | null
}

export interface AlbumDTO {
  id: string
  url: string
  provider: string
  title: string | null
  photographer: string | null
  description: string | null
  dateText: string | null
  coverImageUrl: string | null
  photoCount: number | null
  eventCode: string
}

export interface TeamEventsResult {
  teamNumber: number
  events: EventSearchResult[]
}
