import { sql, eq, or, desc, and, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { currentVoterFingerprint } from '@/lib/voting/fingerprint'
import { getCurrentUser } from '@/lib/auth/session'
import { favorites, tools, toolPrograms, toolLinks, toolVotes, programs, audiencePrimaryRoles, audienceFunctions, toolAudiencePrimaryRoles, toolAudienceFunctions } from '@the-tool-pit/db'
import type { SearchResultRow } from '@/lib/search/search'

// ---------------------------------------------------------------------------
// Helpers to enrich a list of tool IDs with programs, github link, vote count
// ---------------------------------------------------------------------------

async function enrichTools(rows: typeof tools.$inferSelect[]): Promise<SearchResultRow[]> {
  if (rows.length === 0) return []
  const db = getDb()
  const ids = rows.map((r) => r.id)

  const [programRows, linkRows, voteRows] = await Promise.all([
    db
      .select({ toolId: toolPrograms.toolId, slug: programs.slug })
      .from(toolPrograms)
      .innerJoin(programs, eq(programs.id, toolPrograms.programId))
      .where(inArray(toolPrograms.toolId, ids)),
    db
      .select({ toolId: toolLinks.toolId, url: toolLinks.url })
      .from(toolLinks)
      .where(and(inArray(toolLinks.toolId, ids), eq(toolLinks.linkType, 'github'))),
    db
      .select({ toolId: toolVotes.toolId, count: sql<number>`count(*)::int` })
      .from(toolVotes)
      .where(inArray(toolVotes.toolId, ids))
      .groupBy(toolVotes.toolId),
  ])

  const progMap = new Map<string, string[]>()
  for (const r of programRows) {
    const arr = progMap.get(r.toolId) ?? []
    arr.push(r.slug)
    progMap.set(r.toolId, arr)
  }

  const githubMap = new Map<string, string>()
  for (const r of linkRows) githubMap.set(r.toolId, r.url)

  const voteMap = new Map<string, number>()
  for (const r of voteRows) voteMap.set(r.toolId, r.count)

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    summary: r.summary,
    toolType: r.toolType,
    isOfficial: r.isOfficial,
    isVendor: r.isVendor,
    isRookieFriendly: r.isRookieFriendly,
    isTeamCode: r.isTeamCode,
    isTeamCad: r.isTeamCad,
    teamNumber: r.teamNumber ?? null,
    seasonYear: r.seasonYear ?? null,
    freshnessState: r.freshnessState,
    lastActivityAt: r.lastActivityAt,
    popularityScore: r.popularityScore,
    voteCount: (voteMap.get(r.id) ?? 0) + (r.githubStars ?? 0) + (r.chiefDelphiLikes ?? 0),
    programs: progMap.get(r.id) ?? [],
    githubUrl: githubMap.get(r.id) ?? null,
  }))
}

/**
 * The home page's "Trending" row.
 *
 * There is no first-party traffic data yet, so this is popularity (GitHub
 * stars plus Chief Delphi likes plus votes) rather than genuine velocity, and
 * the section is labelled accordingly. What it must NOT do is lead with a dead
 * tool: a 5000-star repo nobody has touched in two years outranking a
 * maintained one is exactly the junk-directory feel the tools vertical already
 * got burned by.
 *
 * So freshness multiplies the score instead of merely tie-breaking it, and
 * anything abandoned or archived is excluded outright. A stale tool can still
 * appear when it is genuinely much more popular, but it has to earn the slot
 * against a 0.35x handicap rather than winning on a star count it collected
 * years ago.
 */
export async function getTrendingTools(limit = 6): Promise<SearchResultRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .where(
      and(
        eq(tools.status, 'published'),
        // A dead tool is not trending by any definition. Unknown freshness is
        // kept: it means we have not checked, not that it is dead.
        sql`coalesce(${tools.freshnessState}, 'unknown') not in ('inactive', 'archived')`,
      ),
    )
    .orderBy(
      desc(sql`
        case coalesce(${tools.freshnessState}, 'unknown')
          when 'stale' then 0.35
          when 'unknown' then 0.7
          else 1.0
        end * coalesce(${tools.popularityScore}, 0)
      `),
    )
    .limit(limit)
  return enrichTools(rows)
}

export async function getRecentlyUpdatedTools(limit = 6): Promise<SearchResultRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .where(and(eq(tools.status, 'published'), sql`${tools.lastActivityAt} is not null`))
    .orderBy(desc(tools.lastActivityAt))
    .limit(limit)
  return enrichTools(rows)
}

export async function getRookieFriendlyTools(limit = 6): Promise<SearchResultRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .where(and(eq(tools.status, 'published'), eq(tools.isRookieFriendly, true)))
    .orderBy(desc(tools.popularityScore))
    .limit(limit)
  return enrichTools(rows)
}

/**
 * The signed-in visitor's saved tools, newest save first.
 *
 * Returns an empty array for a signed-out visitor, so the home page can simply
 * not render the section rather than branching on the session itself.
 *
 * Newest first, not most popular: this list is the visitor's own shortlist and
 * the thing they saved a minute ago is the thing they came back for.
 */
export async function getFavoriteTools(limit = 6): Promise<SearchResultRow[]> {
  const user = await getCurrentUser()
  if (!user) return []

  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .innerJoin(favorites, eq(favorites.entityId, tools.id))
    .where(
      and(
        eq(favorites.userId, user.id),
        eq(favorites.entityType, 'tool'),
        eq(tools.status, 'published'),
      ),
    )
    .orderBy(desc(favorites.createdAt))
    .limit(limit)

  return enrichTools(rows.map((r) => r.tools))
}

/**
 * The home page's Featured row: the tools somebody chose by hand.
 *
 * Empty is a normal answer, and the home page renders no section at all for
 * it. That is the whole contract that keeps this from becoming a chore: an
 * unset Featured row costs nothing and shows nothing, so nobody has to keep it
 * fed. Nothing here expires and nothing rotates.
 *
 * The notes come back beside the tools rather than on them. Only this section
 * shows them, and threading an extra field through SearchResultRow would put a
 * curator's line on every card in search and in Popular, where it says nothing
 * the section title has not already said.
 *
 * Popularity order, the same as Rookie Friendly and Official, so the row reads
 * the same way as its neighbours. A tool with no note is not held back: the
 * flag is the decision and the note is the explanation.
 */
export interface FeaturedTools {
  tools: SearchResultRow[]
  /** Keyed by tool id. A featured tool with no note is simply absent. */
  notes: Record<string, string>
}

export async function getFeaturedTools(limit = 6): Promise<FeaturedTools> {
  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .where(and(eq(tools.status, 'published'), eq(tools.isFeatured, true)))
    .orderBy(desc(tools.popularityScore))
    .limit(limit)

  const notes: Record<string, string> = {}
  for (const row of rows) {
    if (row.featuredNote) notes[row.id] = row.featuredNote
  }

  return { tools: await enrichTools(rows), notes }
}

export async function getOfficialTools(limit = 6): Promise<SearchResultRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .where(and(eq(tools.status, 'published'), eq(tools.isOfficial, true)))
    .orderBy(desc(tools.popularityScore))
    .limit(limit)
  return enrichTools(rows)
}

// ---------------------------------------------------------------------------
// Tool detail — full record with all relations
// ---------------------------------------------------------------------------

export interface ToolDetailData {
  id: string
  slug: string
  name: string
  summary: string | null
  description: string | null
  toolType: string
  isOfficial: boolean
  isVendor: boolean
  isRookieFriendly: boolean
  isTeamCode: boolean
  teamNumber: number | null
  seasonYear: number | null
  vendorName: string | null
  freshnessState: string | null
  lastActivityAt: Date | null
  popularityScore: number
  programs: string[]
  audienceRoles: string[]
  audienceFunctions: string[]
  links: Array<{ linkType: string; url: string; label: string | null; isBroken: boolean }>
  voteCount: number
}

export async function getToolBySlug(slug: string): Promise<ToolDetailData | null> {
  const db = getDb()

  const [tool] = await db
    .select()
    .from(tools)
    .where(and(eq(tools.slug, slug), eq(tools.status, 'published')))
    .limit(1)

  if (!tool) return null

  const [programRows, roleRows, functionRows, linkRows, voteCountResult] = await Promise.all([
    db
      .select({ slug: programs.slug })
      .from(toolPrograms)
      .innerJoin(programs, eq(programs.id, toolPrograms.programId))
      .where(eq(toolPrograms.toolId, tool.id)),

    db
      .select({ slug: audiencePrimaryRoles.slug })
      .from(toolAudiencePrimaryRoles)
      .innerJoin(audiencePrimaryRoles, eq(audiencePrimaryRoles.id, toolAudiencePrimaryRoles.roleId))
      .where(eq(toolAudiencePrimaryRoles.toolId, tool.id)),

    db
      .select({ slug: audienceFunctions.slug })
      .from(toolAudienceFunctions)
      .innerJoin(audienceFunctions, eq(audienceFunctions.id, toolAudienceFunctions.functionId))
      .where(eq(toolAudienceFunctions.toolId, tool.id)),

    db
      .select({
        linkType: toolLinks.linkType,
        url: toolLinks.url,
        label: toolLinks.label,
        isBroken: toolLinks.isBroken,
      })
      .from(toolLinks)
      .where(eq(toolLinks.toolId, tool.id)),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(toolVotes)
      .where(eq(toolVotes.toolId, tool.id)),
  ])

  return {
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    summary: tool.summary,
    description: tool.description,
    toolType: tool.toolType,
    isOfficial: tool.isOfficial,
    isVendor: tool.isVendor,
    isRookieFriendly: tool.isRookieFriendly,
    isTeamCode: tool.isTeamCode,
    teamNumber: tool.teamNumber ?? null,
    seasonYear: tool.seasonYear ?? null,
    vendorName: tool.vendorName,
    freshnessState: tool.freshnessState,
    lastActivityAt: tool.lastActivityAt,
    popularityScore: tool.popularityScore,
    programs: programRows.map((r) => r.slug),
    audienceRoles: roleRows.map((r) => r.slug),
    audienceFunctions: functionRows.map((r) => r.slug),
    links: linkRows,
    voteCount: (voteCountResult[0]?.count ?? 0) + (tool.githubStars ?? 0) + (tool.chiefDelphiLikes ?? 0),
  }
}

/**
 * Which of these tools the current visitor has already upvoted.
 *
 * One query for a whole grid rather than one per card. Returns an empty set for
 * a visitor with no vote cookie, which is the common case and costs nothing.
 */
export async function getVotedToolIds(toolIds: string[]): Promise<Set<string>> {
  if (toolIds.length === 0) return new Set()

  // An account's votes follow the account; a signed-out visitor's follow their
  // cookie. Reading only the cookie is what made an upvote disappear on a
  // second browser: the row was there, keyed to a fingerprint this browser had
  // never had, so the button rendered unpressed over a vote that was counted.
  const [user, fingerprint] = await Promise.all([getCurrentUser(), currentVoterFingerprint()])
  if (!user && !fingerprint) return new Set()

  const db = getDb()
  const mine =
    user && fingerprint
      ? or(eq(toolVotes.userId, user.id), eq(toolVotes.voterFingerprint, fingerprint))
      : user
        ? eq(toolVotes.userId, user.id)
        : eq(toolVotes.voterFingerprint, fingerprint as string)

  const rows = await db
    .select({ toolId: toolVotes.toolId })
    .from(toolVotes)
    .where(and(inArray(toolVotes.toolId, toolIds), mine))
  return new Set(rows.map((r) => r.toolId))
}
