/**
 * The correction loop: a suppression teaches the next classification.
 *
 * A moderator saying "this is a list page, not a grant" used to end in a
 * free-text rejectionReason and stop there. The same page shapes then came back
 * on the next crawl and were rejected by hand again. 82 aggregator pages and a
 * long tail of press releases went through that loop.
 *
 * grant_candidates.rejection_kind is the machine-readable half of the decision,
 * and this module turns recent ones into few-shot negatives for the classifier.
 * The moderator's own sentence rides along because it is the part that explains
 * the call; the bucket is the part that can be counted and matched.
 *
 * Two things keep this from becoming its own failure mode:
 *   - only the most recent examples are used, so a rule that stopped being true
 *     ages out instead of being enforced forever.
 *   - examples are RANKED against the page being judged, so a candidate on
 *     socalftc.org is shown the socalftc.org rejections rather than six
 *     unrelated ones. An unranked pile is just noise in the prompt.
 */
import { and, desc, eq, isNotNull, getDb, grantCandidates } from '@the-tool-pit/db'
import type { GrantRejectionKind } from '@the-tool-pit/db'
import { GRANT_REJECTION_KIND_LABELS } from '@the-tool-pit/db'

export interface SuppressionExample {
  url: string
  kind: GrantRejectionKind
  /** The moderator's own sentence. Short, and the useful part. */
  reason: string | null
  title: string | null
  /** `web_search:<query>` or `chief_delphi:<url>`, so same-connector noise groups. */
  discoveredVia: string | null
  suppressedAt: Date
}

/** How many recent suppressions to hold in memory to rank against. */
const POOL_SIZE = 80

/**
 * How long the pool is reused. One classification job is one candidate, and
 * re-reading 80 rows per candidate is a query per model call for a list that
 * moves when a human clicks something. Five minutes is well inside the time it
 * takes a moderator to change their mind about a source.
 */
const POOL_TTL_MS = 5 * 60 * 1000

let pool: { at: number; rows: SuppressionExample[] } | null = null

/** Recent suppressions that carry a bucket. Cached, see POOL_TTL_MS. */
export async function loadSuppressionExamples(): Promise<SuppressionExample[]> {
  if (pool && Date.now() - pool.at < POOL_TTL_MS) return pool.rows

  const db = getDb()
  const rows = await db
    .select({
      sourceUrl: grantCandidates.sourceUrl,
      canonicalUrl: grantCandidates.canonicalUrl,
      kind: grantCandidates.rejectionKind,
      reason: grantCandidates.rejectionReason,
      rawMetadata: grantCandidates.rawMetadata,
      updatedAt: grantCandidates.updatedAt,
    })
    .from(grantCandidates)
    .where(and(eq(grantCandidates.status, 'suppressed'), isNotNull(grantCandidates.rejectionKind)))
    .orderBy(desc(grantCandidates.updatedAt))
    .limit(POOL_SIZE)

  const examples: SuppressionExample[] = rows.map((row) => ({
    url: row.canonicalUrl ?? row.sourceUrl,
    kind: row.kind as GrantRejectionKind,
    reason: row.reason,
    title: row.rawMetadata?.title ?? null,
    discoveredVia: row.rawMetadata?.discoveredVia ?? null,
    suppressedAt: row.updatedAt,
  }))
  pool = { at: Date.now(), rows: examples }
  return examples
}

export interface RankingSubject {
  url: string
  discoveredVia?: string | null
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function lastSegment(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '')
    return path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  } catch {
    return ''
  }
}

/** The connector half of `web_search:<query>`, which is the shape of the sweep. */
function connectorOf(discoveredVia: string | null | undefined): string {
  const value = discoveredVia ?? ''
  const colon = value.indexOf(':')
  return (colon === -1 ? value : value.slice(0, colon)).trim().toLowerCase()
}

/**
 * Pick the examples worth spending prompt on for THIS page.
 *
 * Same host first, because a site that publishes one press release publishes
 * ten. Then the same discovery angle, because a search query that returned an
 * award announcement returns more of them. Then a matching final path segment,
 * which is what /grants and /team-grants have in common. Recency breaks ties,
 * so a rule that has stopped being true fades out on its own.
 */
export function pickSuppressionExamples(
  examples: readonly SuppressionExample[],
  subject: RankingSubject,
  max = 6,
): SuppressionExample[] {
  const host = hostOf(subject.url)
  const segment = lastSegment(subject.url)
  const connector = connectorOf(subject.discoveredVia)

  const scored = examples.map((example) => {
    let score = 0
    if (host && hostOf(example.url) === host) score += 4
    if (connector && connectorOf(example.discoveredVia) === connector) score += 2
    if (segment && lastSegment(example.url) === segment) score += 1
    return { example, score }
  })

  return scored
    .sort((a, b) => b.score - a.score || b.example.suppressedAt.getTime() - a.example.suppressedAt.getTime())
    .slice(0, max)
    .map((s) => s.example)
}

/**
 * Render the examples as a prompt block. Empty string when there are none, so
 * a fresh database does not get a heading with nothing under it.
 */
export function formatSuppressionExamples(examples: readonly SuppressionExample[]): string {
  if (examples.length === 0) return ''
  const lines = [
    'Pages a human reviewer has REJECTED recently. Each one was judged not to be a grant a team can apply for. Use them as examples of what to reject, not as a rule about any particular site:',
  ]
  for (const example of examples) {
    const label = GRANT_REJECTION_KIND_LABELS[example.kind] ?? example.kind
    const reason = example.reason ? ` Reviewer said: ${example.reason.slice(0, 160)}` : ''
    lines.push(`- ${example.url}${example.title ? ` ("${example.title.slice(0, 80)}")` : ''} => ${label}.${reason}`)
  }
  return lines.join('\n')
}
