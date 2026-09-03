/**
 * Deduplication pipeline stage.
 * Checks if a candidate already exists in the database as a tool or prior candidate.
 * Strategy: URL normalization first, then name similarity check.
 */
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { tools, toolLinks, crawlCandidates } from '@the-tool-pit/db'
import {
  DUPLICATE_NAME_SIMILARITY,
  definitelyDifferentListings,
  identityFromName,
  isHumanEdited,
} from '@the-tool-pit/db'

export interface DedupeResult {
  isDuplicate: boolean
  matchedToolId?: string
  matchedCandidateId?: string
  matchedUrl?: string
  method?: 'url_exact' | 'url_hostname' | 'name_similarity'
  /** The status of the tool a name match landed on, so a caller can log why it blocked. */
  matchedStatus?: 'published' | 'suppressed'
}

/** Steps 1-3: exact URL match in tool_links, exact URL in crawlCandidates, hostname soft match */
/**
 * The comparison key for a URL. Two links point at the same page when they differ
 * only by scheme, a leading www, or a trailing slash: http://lopreiato.me/frc-cycle-times
 * and https://lopreiato.me/frc-cycle-times are one tool, and a raw string match filed
 * them twice. Host is lowercased, www and the trailing slash dropped, path kept as-is.
 */
export function urlDedupeKey(raw: string): string {
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    return host + path + u.search
  } catch {
    return raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
  }
}

/**
 * Two link URLs that point at the same page, ignoring scheme / www / trailing slash.
 * The store-time counterpart to the tool_links prefilter below: it stops one tool from
 * holding both an http and an https row for the same link.
 */
export function sameLinkUrl(a: string, b: string): boolean {
  return urlDedupeKey(a) === urlDedupeKey(b)
}

/**
 * Does this tool already hold a link at this URL, comparing by dedupe key rather than raw
 * string? Used before inserting a link so a re-crawl that carries http where the row holds
 * https, or vice versa, adds nothing. Existing rows are never rewritten, only not doubled.
 */
export async function toolHasLink(toolId: string, url: string): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .select({ url: toolLinks.url })
    .from(toolLinks)
    .where(eq(toolLinks.toolId, toolId))
  return rows.some((r) => sameLinkUrl(r.url, url))
}

export async function checkDuplicateByUrl(canonicalUrl: string): Promise<DedupeResult> {
  const db = getDb()
  const key = urlDedupeKey(canonicalUrl)

  // 1. Same URL in tool_links, ignoring scheme / www / trailing slash. Prefilter by
  //    hostname in SQL (cheap, indexable-ish), then match the normalized key in JS so
  //    http vs https and a stray slash no longer split one tool into two.
  let host = ''
  try {
    host = new URL(canonicalUrl).hostname.replace(/^www\./, '')
  } catch {}
  if (host) {
    const links = await db
      .select({ toolId: toolLinks.toolId, url: toolLinks.url })
      .from(toolLinks)
      .where(sql`${toolLinks.url} like ${'%' + host + '%'}`)
    const existingLink = links.find((l) => urlDedupeKey(l.url) === key)
    if (existingLink) {
      return { isDuplicate: true, matchedToolId: existingLink.toolId, matchedUrl: existingLink.url, method: 'url_exact' }
    }
  }

  // 2. Existing candidate for the same URL that reached a TERMINAL state: either
  //    published (has a matchedToolId) or suppressed by a quality gate / a human.
  //    Both mean we already decided about this URL, so a re-crawl must not re-file
  //    it as new. A PENDING candidate is still excluded on purpose: it is an
  //    in-flight attempt a requeue can reset and retry.
  //
  //    The suppressed arm is what stops the fta.tools loop: that source lists a
  //    couple of URLs that never clear the bar (a WPILib doc page, and a homepage
  //    whose GitHub repo is already listed). Each was suppressed, left no tool row
  //    for step 1 to match, and so was re-counted as "new" every 6 hours, pinging
  //    the review webhook four times a day. Prefer a published match so the forum
  //    -link path below still gets a matchedToolId when one exists.
  const [priorCandidate] = await db
    .select({ id: crawlCandidates.id, matchedToolId: crawlCandidates.matchedToolId, canonicalUrl: crawlCandidates.canonicalUrl })
    .from(crawlCandidates)
    .where(
      and(
        eq(crawlCandidates.canonicalUrl, canonicalUrl),
        or(isNotNull(crawlCandidates.matchedToolId), eq(crawlCandidates.status, 'suppressed')),
      ),
    )
    .orderBy(sql`${crawlCandidates.matchedToolId} nulls last`)
    .limit(1)

  if (priorCandidate) {
    return {
      isDuplicate: true,
      matchedCandidateId: priorCandidate.id,
      matchedToolId: priorCandidate.matchedToolId ?? undefined,
      matchedUrl: priorCandidate.canonicalUrl ?? undefined,
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
 * May a tool with this status and edit history block a new listing of the same name?
 *
 * A published tool always blocks. A suppressed tool blocks only when a human set the
 * status (its human_edited_fields carries 'status', the same marker suppressMatchedTool
 * reads before it dares overwrite a moderator). Auto-suppressed spam never blocks, which
 * is the "22 names behind the curtain" bug we do not want back. A draft never blocks.
 *
 * Pure, so the rule can be tested without a database and cannot drift from the intent.
 */
export function suppressionBlocksName(
  status: string,
  humanEditedFields: readonly string[] | null | undefined,
): boolean {
  if (status === 'published') return true
  if (status === 'suppressed') return isHumanEdited(humanEditedFields, 'status')
  return false
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
 * from behind the curtain. But a human who suppresses a listing has made a
 * decision, and re-importing the same name and PUBLISHING it walked straight
 * over that decision (docs.wpilib.org came back as a "...-1" slug the day after
 * a moderator hid it). So a suppressed row blocks again when, and only when, a
 * human set that status. Auto-suppressed spam still steps aside. See
 * suppressionBlocksName.
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
  //
  // Both published and suppressed rows are fetched; suppressionBlocksName decides
  // which of the suppressed ones actually count, in JS where it is testable. The
  // limit is 10 rather than 5 so a cluster of auto-suppressed spam cannot crowd the
  // one published (or human-suppressed) row that should have blocked out of the window.
  const similar = await db
    .select({
      id: tools.id,
      name: tools.name,
      teamNumber: tools.teamNumber,
      seasonYear: tools.seasonYear,
      status: tools.status,
      humanEditedFields: tools.humanEditedFields,
    })
    .from(tools)
    .where(
      and(
        inArray(tools.status, ['published', 'suppressed']),
        sql`similarity(${tools.name}, ${title}) > ${DUPLICATE_NAME_SIMILARITY}`,
      ),
    )
    .orderBy(sql`similarity(${tools.name}, ${title}) desc`)
    .limit(10)

  for (const candidate of similar) {
    // A suppressed row only blocks when a human suppressed it. Spam that the
    // pipeline auto-hid must not go on rejecting real listings.
    if (!suppressionBlocksName(candidate.status, candidate.humanEditedFields)) continue

    // The stored row's own columns first: the classifier filled them and a
    // human may have corrected them, so they beat anything parsed from a name.
    // Fall back to the name for the few rows that carry neither.
    const parsed = identityFromName(candidate.name)
    const stored = {
      teamNumber: candidate.teamNumber ?? parsed.teamNumber,
      seasonYear: candidate.seasonYear ?? parsed.seasonYear,
    }
    if (definitelyDifferentListings(incoming, stored)) continue

    return {
      isDuplicate: true,
      matchedToolId: candidate.id,
      method: 'name_similarity',
      matchedStatus: candidate.status === 'suppressed' ? 'suppressed' : 'published',
    }
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
