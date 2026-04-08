/**
 * Shared types used by both apps/web and apps/worker.
 * These are pure TypeScript types — no runtime dependencies.
 */

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
  /** Ranking score (higher = better) — not exposed to UI */
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
