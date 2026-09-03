import { sql } from 'drizzle-orm'
import { Queue } from 'bullmq'
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
  /** Off-season events > Suggested edits. */
  eventEdits: number
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
  eventEdits: 0,
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
    union all select 'eventEdits', count(*)::int from event_edit_proposals where status = 'pending'
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

/** One backlog row for the dashboard: how much is waiting and since when. */
export interface AdminQueueBacklogRow {
  key: keyof AdminQueueCounts
  /** Human label for the dashboard table. */
  label: string
  /** Where the row links, the same target the sidebar uses. */
  href: string
  /** Pending rows in this queue. */
  count: number
  /** created_at of the OLDEST pending row, or null when the queue is empty. */
  oldestPendingAt: Date | null
}

/**
 * The sidebar order, label and link for every queue, so the dashboard names and
 * links each backlog the same way the nav does. Kept beside the count query on
 * purpose: a queue added to one is added to the other here.
 */
const QUEUE_META: { key: keyof AdminQueueCounts; label: string; href: string }[] = [
  { key: 'toolSubmissions', label: 'Tool submissions', href: '/admin/submissions?status=pending' },
  { key: 'toolCandidates', label: 'Tool candidates', href: '/admin/candidates?status=pending' },
  { key: 'albumCandidates', label: 'Album candidates', href: '/admin/album-candidates' },
  { key: 'eventSubmissions', label: 'Event submissions', href: '/admin/event-listings' },
  { key: 'eventCandidates', label: 'Event candidates', href: '/admin/event-listings/candidates' },
  { key: 'eventEdits', label: 'Event suggested edits', href: '/admin/event-edits' },
  { key: 'fieldSubmissions', label: 'Field submissions', href: '/admin/practice-fields' },
  { key: 'fieldCandidates', label: 'Field candidates', href: '/admin/practice-fields/candidates' },
  { key: 'fieldEdits', label: 'Field suggested edits', href: '/admin/field-edits' },
  { key: 'grantCandidates', label: 'Grant candidates', href: '/admin/grants/candidates' },
  { key: 'grantChanges', label: 'Grant changes', href: '/admin/grants/changes' },
  { key: 'listingClaims', label: 'Listing claims', href: '/admin/claims' },
]

/**
 * The dashboard view of every queue: count PLUS the age of the oldest pending
 * row. The count query above is the sidebar's hot path and stays untouched;
 * this one is a second UNION ALL that also reads min(created_at), so the
 * overview can show the two largest queues (albums and grants) the badges omit
 * without slowing the nav that renders on every page.
 */
export async function getAdminQueueBacklog(): Promise<AdminQueueBacklogRow[]> {
  const db = getDb()

  const rows = await db.execute<{ key: string; n: number; oldest: string | null }>(sql`
    select 'toolSubmissions' as key, count(*)::int as n, min(created_at) as oldest from submissions where status = 'pending'
    union all select 'toolCandidates', count(*)::int, min(created_at) from crawl_candidates where status = 'pending'
    union all select 'albumCandidates', count(*)::int, min(created_at) from album_candidates where status = 'pending'
    union all select 'eventSubmissions', count(*)::int, min(created_at) from event_listings where status = 'pending'
    union all select 'eventCandidates', count(*)::int, min(created_at) from event_listing_candidates where status = 'pending'
    union all select 'eventEdits', count(*)::int, min(created_at) from event_edit_proposals where status = 'pending'
    union all select 'fieldSubmissions', count(*)::int, min(created_at) from practice_fields where status = 'pending'
    union all select 'fieldCandidates', count(*)::int, min(created_at) from practice_field_candidates where status = 'pending'
    union all select 'fieldEdits', count(*)::int, min(created_at) from field_edit_proposals where status = 'pending'
    union all select 'grantCandidates', count(*)::int, min(created_at) from grant_candidates where status = 'pending'
    union all select 'grantChanges', count(*)::int, min(created_at) from grant_changes where status = 'pending'
    union all select 'listingClaims', count(*)::int, min(created_at) from listing_claims where status = 'pending'
  `)

  const byKey = new Map(rows.map((r) => [r.key, r]))
  return QUEUE_META.map((meta) => {
    const row = byKey.get(meta.key)
    return {
      ...meta,
      count: row?.n ?? 0,
      oldestPendingAt: row?.oldest ? new Date(row.oldest) : null,
    }
  })
}

/**
 * The two worker queues whose state lives in Redis, not Postgres.
 *
 * Reading candidates and refreshing rosters run entirely through BullMQ and
 * never touch the *_crawl_jobs tables the dashboard reads, so neither shows up
 * anywhere else on the admin. An overnight read that keeps failing, or a roster
 * sweep that has piled up behind a stuck browser, would be invisible without
 * this.
 */
interface WorkerQueueSpec {
  /** The BullMQ queue name, from apps/worker/src/queues.ts. */
  name: string
  /** Human label for the dashboard row. */
  label: string
  /** Where the row links. */
  href: string
}

const WORKER_QUEUES: WorkerQueueSpec[] = [
  // Off-season event / practice-field candidate reads (model + browser).
  { name: 'read-candidates', label: 'Reading jobs', href: '/admin/event-listings/candidates' },
  // Registered-team-count refresh from TBA / team-list URLs.
  { name: 'roster-refresh', label: 'Team-list crawls', href: '/admin/event-listings' },
]

/** One dashboard row for a Redis-backed worker queue. */
export interface WorkerQueueRow {
  key: string
  label: string
  href: string
  /** Jobs enqueued and not yet picked up. */
  waiting: number
  /** Jobs running right now. */
  active: number
  /** Jobs that exhausted their retries. The actionable number. */
  failed: number
  /** Enqueue time of the oldest waiting job, or null when nothing waits. */
  oldestWaitingAt: Date | null
}

/**
 * Live BullMQ counts for the worker queues the DB-backed backlog cannot see.
 *
 * Each queue gets its own short-lived connection (the maintenance page pattern):
 * passing the shared getRedis() singleton and then calling close() would tear
 * down the connection the rest of the request relies on, so BullMQ owns and
 * closes a URL-based connection instead. Fails open, an unreachable Redis
 * returns zeros rather than 500-ing the whole overview.
 */
export async function getWorkerQueueBacklog(): Promise<WorkerQueueRow[]> {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) return WORKER_QUEUES.map((q) => emptyWorkerRow(q))

  return Promise.all(
    WORKER_QUEUES.map(async (spec) => {
      const queue = new Queue(spec.name, { connection: { url: redisUrl } })
      try {
        const counts = await queue.getJobCounts('active', 'waiting', 'delayed', 'completed', 'failed')
        // The single oldest waiting job carries the enqueue time; index 0..0 is
        // one job, and an empty queue returns an empty array.
        const [oldest] = await queue.getWaiting(0, 0)
        return {
          key: spec.name,
          label: spec.label,
          href: spec.href,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          failed: counts.failed ?? 0,
          oldestWaitingAt: oldest?.timestamp ? new Date(oldest.timestamp) : null,
        }
      } catch (err) {
        console.error(`[admin] could not read worker queue ${spec.name}:`, err)
        return emptyWorkerRow(spec)
      } finally {
        await queue.close()
      }
    }),
  )
}

function emptyWorkerRow(spec: WorkerQueueSpec): WorkerQueueRow {
  return {
    key: spec.name,
    label: spec.label,
    href: spec.href,
    waiting: 0,
    active: 0,
    failed: 0,
    oldestWaitingAt: null,
  }
}
