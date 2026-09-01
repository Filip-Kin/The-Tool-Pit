/**
 * Shared shape for every grant DISCOVER connector.
 *
 * Four unrelated angles feed this pipeline (curated seeds, web search, team
 * sponsor pages, Chief Delphi leads) because no single angle finds everything:
 * search only surfaces funders with good SEO, sponsor pages only surface
 * funders that already gave money to somebody, and the forum only surfaces
 * what a team happened to post about. They all reduce to the same candidate
 * row so the moderation queue stays one queue.
 *
 * A candidate is a LEAD, never a listing. Nothing on this path may write to
 * the grants table; discover.ts inserts grant_candidates with status
 * 'pending' and a human decides.
 */

export interface GrantCandidateInput {
  /** The page we found the lead ON: a search result page, a forum thread, a team site. */
  sourceUrl: string
  /**
   * The page we think a human should read, canonicalised (scheme+host+path,
   * tracking parameters stripped). This is the dedup key, so it must point at
   * the funder, never at the forum thread or search engine that surfaced it.
   */
  canonicalUrl: string
  title: string
  description?: string
  /** Only set when the connector actually read a funder name, never guessed. */
  funderName?: string
  /** Set when the connector saw a separate apply link, e.g. a Google Form. */
  applicationUrl?: string
  /**
   * Audit trail for the reviewer: the exact query, thread or team page that
   * produced this. Reviewers reject differently when they can see a lead came
   * from a forum post rather than from the funder's own site.
   */
  discoveredVia: string
  /** grant_sources row this came from, when the connector walked curated rows. */
  sourceId?: string
}

export interface GrantConnectorResult {
  candidates: GrantCandidateInput[]
  /** Pages or results the connector deliberately did not turn into candidates. */
  skipped: number
  /** Fetches or parses that blew up. Recorded, never thrown away. */
  errors: string[]
  /**
   * Anything that BOUNDED coverage on this run: a top-N, a per-run query cap,
   * an exhausted API budget, a source skipped because it is not due yet.
   *
   * This exists because a silent cap reads as "we searched everything" when we
   * did not. discover.ts persists these onto the crawl job, so a bounded run
   * is visible to an admin rather than being a number nobody questions.
   */
  limits: string[]
  /** grant_sources rows this run actually touched, so lastRunAt can be stamped. */
  touchedSourceIds?: string[]
}

export interface GrantConnectorContext {
  /** Set when a single grant_sources row was requeued by hand. */
  sourceId?: string
}

export interface GrantConnector {
  name: string
  run(ctx: GrantConnectorContext): Promise<GrantConnectorResult>
}

/** Empty result, so a connector that bails early still reports honestly. */
export function emptyResult(reason?: string): GrantConnectorResult {
  return {
    candidates: [],
    skipped: 0,
    errors: reason ? [reason] : [],
    limits: [],
  }
}
