/**
 * Shared shape for the off-season event and practice-field DISCOVER
 * connectors.
 *
 * Both verticals had no crawl at all before this, which is why each has one
 * admin page and nothing behind it. They are kept on one contract and one
 * queue because they are the same job done twice: sweep somewhere teams talk,
 * read what can be read without guessing, and file the rest as a question for
 * a human. The two candidate payloads differ only in which columns they will
 * eventually fill.
 *
 * A candidate is a LEAD, never a listing. Nothing on this path may write to
 * `event_listings` or `practice_fields`. discover.ts inserts candidates with
 * status 'pending' and a person decides.
 */
import type {
  ExtractedEventListingFields,
  ExtractedPracticeFieldFields,
} from '@the-tool-pit/db'

/** Which vertical a connector feeds. Discriminates the union below. */
export type ListingVertical = 'event' | 'field'

interface ListingCandidateBase {
  /** The page the lead was found ON: a TBA event page, a forum thread. */
  sourceUrl: string
  /** Dedup key, canonicalised. Tracking parameters stripped, no fragment. */
  canonicalUrl: string
  title: string
  description?: string
  /**
   * Audit trail for the reviewer: the exact query, thread or endpoint that
   * produced this. People reject differently once they can see a lead came
   * from a forum post rather than from a structured source.
   */
  discoveredVia: string
  /**
   * The literal strings a parse keyed off. A reviewer can check a date they
   * can see the working for; they cannot check one that arrived bare.
   */
  evidence?: string[]
  /** Outbound links found beside the lead, in the order they appeared. */
  links?: string[]
  /** Crawl source row this came from, when the connector walked curated rows. */
  sourceId?: string
}

export interface EventListingCandidateInput extends ListingCandidateBase {
  /** Set only by connectors that read a real TBA key, never derived from a name. */
  tbaKey?: string
  /** TBA event_type verbatim: 99 offseason, 100 preseason. */
  tbaEventType?: number
  extracted: ExtractedEventListingFields
}

export interface PracticeFieldCandidateInput extends ListingCandidateBase {
  /** Team number read off the thread, when it named one unambiguously. */
  teamNumber?: number
  /**
   * Phrases bearing on the field spec, e.g. "full field", "we have an FMS".
   * Evidence for a human, never a parsed value: a thread that says "full
   * field" may be describing the field the poster wants, not the one offered.
   */
  signals?: string[]
  extracted: ExtractedPracticeFieldFields
}

export interface ListingConnectorResult<C> {
  candidates: C[]
  /** Results the connector deliberately did not turn into candidates. */
  skipped: number
  /** Fetches or parses that blew up. Recorded, never thrown away. */
  errors: string[]
  /**
   * Anything that BOUNDED coverage on this run: a top-N, a per-run fetch cap,
   * a recency window, past events not listed. Without these a bounded run
   * reads as a complete one, which is how a directory quietly stops growing.
   */
  limits: string[]
  /** Crawl source rows this run touched, so lastRunAt can be stamped. */
  touchedSourceIds?: string[]
}

export interface ListingConnectorContext {
  /** Set when a single crawl source row was requeued by hand from the admin. */
  sourceId?: string
  /** The source row's `config` jsonb, when one was found. */
  config?: Record<string, unknown>
}

export interface EventListingConnector {
  name: string
  vertical: 'event'
  /** FIELD_CRAWL/EVENT_LISTING_SOURCE_KINDS value this connector's source row uses. */
  sourceKind: string
  run(ctx: ListingConnectorContext): Promise<ListingConnectorResult<EventListingCandidateInput>>
}

export interface PracticeFieldConnector {
  name: string
  vertical: 'field'
  sourceKind: string
  run(ctx: ListingConnectorContext): Promise<ListingConnectorResult<PracticeFieldCandidateInput>>
}

export type ListingConnector = EventListingConnector | PracticeFieldConnector

/** Empty result, so a connector that bails early still reports honestly. */
export function emptyListingResult<C>(reason?: string): ListingConnectorResult<C> {
  return { candidates: [], skipped: 0, errors: reason ? [reason] : [], limits: [] }
}
