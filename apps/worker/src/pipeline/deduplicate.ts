/**
 * Deduplication pipeline stage.
 * Checks if a candidate already exists in the database as a tool or prior candidate.
 * Strategy: URL normalization first, then name similarity check.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { tools, toolLinks, crawlCandidates } from '@the-tool-pit/db'
import {
  DUPLICATE_NAME_SIMILARITY,
  definitelyDifferentListings,
  identityFromName,
} from '@the-tool-pit/db'

export interface DedupeResult {
  isDuplicate: boolean
  matchedToolId?: string
  matchedCandidateId?: string
  matchedUrl?: string
  method?: 'url_exact' | 'url_hostname' | 'name_similarity'
}

/** Steps 1-3: exact URL match in tool_links, exact URL in crawlCandidates, hostname soft match */
export async function checkDuplicateByUrl(canonicalUrl: string): Promise<DedupeResult> {
  const db = getDb()

  // 1. Exact URL match in tool_links
  const [existingLink] = await db
    .select({ toolId: toolLinks.toolId, url: toolLinks.url })
    .from(toolLinks)
    .where(eq(toolLinks.url, canonicalUrl))
    .limit(1)

  if (existingLink) {
    return { isDuplicate: true, matchedToolId: existingLink.toolId, matchedUrl: existingLink.url, method: 'url_exact' }
  }

  // 2. Existing candidate with same URL that was actually published (has a matchedToolId).
  //    Pending/suppressed candidates are NOT considered duplicates — they are prior attempts
  //    at the same URL that can be reset and retried (e.g. on requeue).
  const [publishedCandidate] = await db
    .select({ id: crawlCandidates.id, matchedToolId: crawlCandidates.matchedToolId, canonicalUrl: crawlCandidates.canonicalUrl })
    .from(crawlCandidates)
    .where(and(eq(crawlCandidates.canonicalUrl, canonicalUrl), isNotNull(crawlCandidates.matchedToolId)))
    .limit(1)

  if (publishedCandidate) {
    return {
      isDuplicate: true,
      matchedCandidateId: publishedCandidate.id,
      matchedToolId: publishedCandidate.matchedToolId ?? undefined,
      matchedUrl: publishedCandidate.canonicalUrl ?? undefined,
      method: 'url_exact',
    }
  }

  // 3. Hostname-based match (different paths, same domain)
  try {
    const hostname = new URL(canonicalUrl).hostname
    const [hostMatch] = await db
      .select({ toolId: toolLinks.toolId, url: toolLinks.url })
      .from(toolLinks)
      .where(sql`${toolLinks.url} like ${'%' + hostname + '%'}`)
      .limit(1)

    if (hostMatch) {
      return { isDuplicate: false, matchedToolId: hostMatch.toolId, matchedUrl: hostMatch.url, method: 'url_hostname' }
      // Note: not marking as full duplicate — same domain might be a different tool
    }
  } catch {}

  return { isDuplicate: false }
}

/**
 * Step 4: a name close enough to something we already hold.
 *
 * THIS STEP DELETES WORK. A hit here drops the candidate before it is ever
 * written down, so a false positive is a listing nobody knows is missing. It
 * had two of them.
 *
 * The threshold was 0.7 here and 0.85 in the admin duplicate panel, so anything
 * scoring between them was discarded by the crawler and invisible to the
 * screen built to review exactly this. One constant now, and it is the panel's.
 *
 * The status filter was missing, so 22 published names were being blocked by
 * SUPPRESSED rows: spam that was rejected once went on rejecting real listings
 * from behind the curtain.
 *
 * And the archive is meant to hold every season of a team's code and CAD.
 * "1511 2023 Robot Code" against "1511 2026 Robot Code" scores 0.826, as does
 * "3407 2023" against "3405 2023", which is two different teams. Similarity
 * cannot see the only part of those names that carries meaning, so the team and
 * the season are checked directly and they overrule it.
 */
export async function checkDuplicateByName(title: string): Promise<DedupeResult> {
  if (!title || title.length < 3) return { isDuplicate: false }

  const db = getDb()
  const incoming = identityFromName(title)

  // Several, not one. The closest name by score is often not the one that
  // shares a team and a season, and taking only the top row would call a
  // different season a duplicate of it.
  const similar = await db
    .select({ id: tools.id, name: tools.name, teamNumber: tools.teamNumber, seasonYear: tools.seasonYear })
    .from(tools)
    .where(
      and(
        eq(tools.status, 'published'),
        sql`similarity(${tools.name}, ${title}) > ${DUPLICATE_NAME_SIMILARITY}`,
      ),
    )
    .orderBy(sql`similarity(${tools.name}, ${title}) desc`)
    .limit(5)

  for (const candidate of similar) {
    // The stored row's own columns first: the classifier filled them and a
    // human may have corrected them, so they beat anything parsed from a name.
    // Fall back to the name for the few rows that carry neither.
    const parsed = identityFromName(candidate.name)
    const stored = {
      teamNumber: candidate.teamNumber ?? parsed.teamNumber,
      seasonYear: candidate.seasonYear ?? parsed.seasonYear,
    }
    if (definitelyDifferentListings(incoming, stored)) continue

    return { isDuplicate: true, matchedToolId: candidate.id, method: 'name_similarity' }
  }

  return { isDuplicate: false }
}

/** Backward-compatible wrapper for submission pipeline */
export async function checkDuplicate(
  canonicalUrl: string,
  title?: string,
): Promise<DedupeResult> {
  const urlResult = await checkDuplicateByUrl(canonicalUrl)
  if (urlResult.isDuplicate) return urlResult

  if (title) {
    const nameResult = await checkDuplicateByName(title)
    if (nameResult.isDuplicate) return nameResult
  }

  return { isDuplicate: false }
}
