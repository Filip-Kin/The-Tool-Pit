import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'

/**
 * How much work is waiting behind each sidebar entry that is a queue.
 *
 * ONE QUERY, NOT ONE PER ENTRY. The sidebar renders on every admin page load
 * and it has eleven queues in it. Eleven round trips to Postgres to decorate a
 * nav would cost more than most of the pages the nav sits beside. This is a
 * single UNION ALL of eleven counts, every branch a count over an indexed
 * status column, and it measures about a millisecond against the production
 * tables.
 *
 * Only 'pending' is counted, in every table. A badge answers "is there
 * anything to do here", not "how big is this table", so a queue somebody has
 * already worked through has to go quiet. That is also why the nav renders
 * nothing at all for a zero rather than a badge saying 0: a queue at zero is
 * the normal state and it should look like the normal state.
 *
 * Statuses are literal rather than imported from the enums because this is one
 * SQL string, and the string is fixed at author time with no input in it.
 */
export interface AdminQueueCounts {
  /** Tools > Submissions. */
  toolSubmissions: number
  /** Tools > Candidates. */
  toolCandidates: number
  /** Photos > Candidates. */
  albumCandidates: number
  /** Off-season events > Submissions. */
  eventSubmissions: number
  /** Off-season events > Candidates. */
  eventCandidates: number
  /** Practice fields > Submissions. */
  fieldSubmissions: number
  /** Practice fields > Candidates. */
  fieldCandidates: number
  /** Practice fields > Suggested edits. */
  fieldEdits: number
  /** Grants > Candidates. */
  grantCandidates: number
  /** Grants > Changes. */
  grantChanges: number
  /** Accounts > Listing claims. */
  listingClaims: number
}

const EMPTY: AdminQueueCounts = {
  toolSubmissions: 0,
  toolCandidates: 0,
  albumCandidates: 0,
  eventSubmissions: 0,
  eventCandidates: 0,
  fieldSubmissions: 0,
  fieldCandidates: 0,
  fieldEdits: 0,
  grantCandidates: 0,
  grantChanges: 0,
  listingClaims: 0,
}

export async function getAdminQueueCounts(): Promise<AdminQueueCounts> {
  const db = getDb()

  const rows = await db.execute<{ key: string; n: number }>(sql`
    select 'toolSubmissions' as key, count(*)::int as n from submissions where status = 'pending'
    union all select 'toolCandidates', count(*)::int from crawl_candidates where status = 'pending'
    union all select 'albumCandidates', count(*)::int from album_candidates where status = 'pending'
    union all select 'eventSubmissions', count(*)::int from event_listings where status = 'pending'
    union all select 'eventCandidates', count(*)::int from event_listing_candidates where status = 'pending'
    union all select 'fieldSubmissions', count(*)::int from practice_fields where status = 'pending'
    union all select 'fieldCandidates', count(*)::int from practice_field_candidates where status = 'pending'
    union all select 'fieldEdits', count(*)::int from field_edit_proposals where status = 'pending'
    union all select 'grantCandidates', count(*)::int from grant_candidates where status = 'pending'
    union all select 'grantChanges', count(*)::int from grant_changes where status = 'pending'
    union all select 'listingClaims', count(*)::int from listing_claims where status = 'pending'
  `)

  const counts = { ...EMPTY }
  for (const row of rows) {
    if (row.key in counts) counts[row.key as keyof AdminQueueCounts] = row.n
  }
  return counts
}
