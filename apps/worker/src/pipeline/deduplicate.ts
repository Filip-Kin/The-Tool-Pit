/**
 * Deduplication pipeline stage.
 * Checks if a candidate already exists in the database as a tool or prior candidate.
 * Strategy: URL normalization first, then name similarity check.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { tools, toolLinks, crawlCandidates } from '@the-tool-pit/db'

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

/** Step 4: pg_trgm similarity(tools.name, title) > 0.7 */
export async function checkDuplicateByName(title: string): Promise<DedupeResult> {
  if (!title || title.length < 3) return { isDuplicate: false }

  const db = getDb()
  const [similarTool] = await db
    .select({ id: tools.id })
    .from(tools)
    .where(sql`similarity(${tools.name}, ${title}) > 0.7`)
    .limit(1)

  if (similarTool) {
    return { isDuplicate: true, matchedToolId: similarTool.id, method: 'name_similarity' }
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
