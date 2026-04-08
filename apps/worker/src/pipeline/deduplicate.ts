/**
 * Deduplication pipeline stage.
 * Checks if a candidate already exists in the database as a tool or prior candidate.
 * Strategy: URL normalization first, then name similarity check.
 */
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { tools, toolLinks, crawlCandidates } from '@the-tool-pit/db'

export interface DedupeResult {
  isDuplicate: boolean
  matchedToolId?: string
  matchedCandidateId?: string
  method?: 'url_exact' | 'url_hostname' | 'name_similarity'
}

/** Steps 1-3: exact URL match in tool_links, exact URL in crawlCandidates, hostname soft match */
export async function checkDuplicateByUrl(canonicalUrl: string): Promise<DedupeResult> {
  const db = getDb()

  // 1. Exact URL match in tool_links
  const [existingLink] = await db
    .select({ toolId: toolLinks.toolId })
    .from(toolLinks)
    .where(eq(toolLinks.url, canonicalUrl))
    .limit(1)

  if (existingLink) {
    return { isDuplicate: true, matchedToolId: existingLink.toolId, method: 'url_exact' }
  }

  // 2. Existing candidate with same URL
  const [existingCandidate] = await db
    .select({ id: crawlCandidates.id, matchedToolId: crawlCandidates.matchedToolId })
    .from(crawlCandidates)
    .where(eq(crawlCandidates.canonicalUrl, canonicalUrl))
    .limit(1)

  if (existingCandidate) {
    return {
      isDuplicate: true,
      matchedCandidateId: existingCandidate.id,
      matchedToolId: existingCandidate.matchedToolId ?? undefined,
      method: 'url_exact',
    }
  }

  // 3. Hostname-based match (different paths, same domain)
  try {
    const hostname = new URL(canonicalUrl).hostname
    const [hostMatch] = await db
      .select({ toolId: toolLinks.toolId })
      .from(toolLinks)
      .where(sql`${toolLinks.url} like ${'%' + hostname + '%'}`)
      .limit(1)

    if (hostMatch) {
      return { isDuplicate: false, matchedToolId: hostMatch.toolId, method: 'url_hostname' }
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
