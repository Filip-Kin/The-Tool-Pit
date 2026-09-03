import { sql, eq, or, desc, and, inArray, notInArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { currentVoterFingerprint } from '@/lib/voting/fingerprint'
import { getCurrentUser } from '@/lib/auth/session'
import { favorites, tools, toolPrograms, toolLinks, toolVotes, programs, audiencePrimaryRoles, audienceFunctions, toolAudiencePrimaryRoles, toolAudienceFunctions } from '@the-tool-pit/db'
import { seasonalDecaySql } from '@/lib/ranking/seasonal-decay'
import { isFirstPartyUrl, DISCOVER_EXCLUDED_SLUGS } from '@/lib/tools/curation'
import type { SearchResultRow } from '@/lib/search/search'

/**
 * A search row plus whether we host the tool ourselves.
 *
 * firstParty is derived in enrichTools from the homepage link's host, so it
 * costs one extra fetch per grid and no schema change. Everything the home page
 * renders carries it; a plain SearchResultRow (search results) simply omits it
 * and the card shows no badge.
 */
export type ToolListRow = SearchResultRow & { firstParty: boolean }

// ---------------------------------------------------------------------------
// Helpers to enrich a list of tool IDs with programs, github link, vote count
// ---------------------------------------------------------------------------

async function enrichTools(rows: typeof tools.$inferSelect[]): Promise<ToolListRow[]> {
  if (rows.length === 0) return []
  const db = getDb()
  const ids = rows.map((r) => r.id)

  const [programRows, functionRows, linkRows, homepageRows, voteRows] = await Promise.all([
    db
      .select({ toolId: toolPrograms.toolId, slug: programs.slug })
      .from(toolPrograms)
      .innerJoin(programs, eq(programs.id, toolPrograms.programId))
      .where(inArray(toolPrograms.toolId, ids)),
    db
      .select({ toolId: toolAudienceFunctions.toolId, slug: audienceFunctions.slug })
      .from(toolAudienceFunctions)
      .innerJoin(audienceFunctions, eq(audienceFunctions.id, toolAudienceFunctions.functionId))
      .where(inArray(toolAudienceFunctions.toolId, ids)),
    db
      .select({ toolId: toolLinks.toolId, url: toolLinks.url })
      .from(toolLinks)
      .where(and(inArray(toolLinks.toolId, ids), eq(toolLinks.linkType, 'github'))),
    db
      .select({ toolId: toolLinks.toolId, url: toolLinks.url })
      .from(toolLinks)
      .where(and(inArray(toolLinks.toolId, ids), eq(toolLinks.linkType, 'homepage'))),
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

  const funcMap = new Map<string, string[]>()
  for (const r of functionRows) {
    const arr = funcMap.get(r.toolId) ?? []
    arr.push(r.slug)
    funcMap.set(r.toolId, arr)
  }

  const githubMap = new Map<string, string>()
  for (const r of linkRows) githubMap.set(r.toolId, r.url)

  // First-party is the homepage's host under frc.tools, computed here so no
  // column has to store a fact that is already in the link.
  const firstPartyIds = new Set<string>()
  for (const r of homepageRows) {
    if (isFirstPartyUrl(r.url)) firstPartyIds.add(r.toolId)
  }

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
    audienceFunctions: funcMap.get(r.id) ?? [],
    githubUrl: githubMap.get(r.id) ?? null,
    firstParty: firstPartyIds.has(r.id),
  }))
}

/**
 * "Not dead", as a value rather than a phrase copied per query.
 *
 * The home page recommends. Popular excluded inactive and archived listings
 * from the day it was written, and Rookie Friendly did not, because the
 * exclusion was three lines of inline SQL inside one query and nothing carried
 * it to the next one. Rookie Friendly opened with an inactive Java tutorial and
 * an archived RobotPy example, which is the worst possible audience to hand a
 * dead link to: a rookie has no way to tell that the tool stopped and we do.
 *
 * Unknown passes. It means there is no repo to read a commit date from, not
 * that nothing is happening, and it covers 478 of the 1094 published listings.
 *
 * Kept in one place and asserted by tests/unit/recommendations-exclude-dead-tools.test.ts,
 * so a section added later either uses it or the test says which one does not.
 */
export const ALIVE_ENOUGH_TO_RECOMMEND = sql`coalesce(${tools.freshnessState}, 'unknown') not in ('inactive', 'archived')`

/**
 * The home page's "Discover" row.
 *
 * There is no first-party traffic data yet, so this is popularity (GitHub
 * stars plus Chief Delphi likes plus votes) tempered by a seasonal decay,
 * rather than genuine velocity. What it must NOT do is read like a link farm:
 * a veteran told us the front page led with WPILib, PathPlanner, ReCalc and The
 * Blue Alliance, every one of which they already had bookmarked, and none of
 * which is news. Discover is the row for what they have NOT seen.
 *
 * THREE MECHANISMS, and they are not substitutes for each other.
 *
 * The dead exclusion removes. Anything inactive or archived is off the row
 * outright, and it has to be, because no multiplier is small enough to do that
 * job: WPILib silent for two seasons still scores 1301 times any sane decay and
 * would lead the page over everything maintained.
 *
 * The giant exclusion removes too, but for the opposite reason: these are alive
 * and enormous and everyone knows them. DISCOVER_EXCLUDED_SLUGS lists them by
 * hand (see lib/tools/curation.ts). They keep their full standing in Popular,
 * in search and on their own pages; this row just does not spend its six slots
 * re-introducing them.
 *
 * The decay multiplier reorders what is left. Its clock skips May to August
 * because a quiet FIRST summer is not evidence of anything, and unknown
 * activity keeps a flat 0.7, which is 478 of the 1094 published listings. See
 * lib/ranking/seasonal-decay.ts.
 */
export async function getDiscoverTools(limit = 6): Promise<ToolListRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .where(
      and(
        eq(tools.status, 'published'),
        // A dead tool is not a discovery by any definition.
        ALIVE_ENOUGH_TO_RECOMMEND,
        // FIRST's own resources have their own section, and they are popular by
        // construction: everybody uses WPILib because there is no alternative,
        // not because the community picked it.
        sql`${tools.isOfficial} is not true`,
        // The eternal giants. Present everywhere else, absent here so the row
        // surfaces rising work instead of the usual names.
        DISCOVER_EXCLUDED_SLUGS.length > 0
          ? notInArray(tools.slug, [...DISCOVER_EXCLUDED_SLUGS])
          : undefined,
      ),
    )
    .orderBy(desc(sql`${seasonalDecaySql} * coalesce(${tools.popularityScore}, 0)`))
    .limit(limit)
  return enrichTools(rows)
}

/**
 * The home page's "Built on FRC.tools" row: the tools we host ourselves.
 *
 * Answers the other half of the veteran's complaint, that the page mixed our
 * own first-party work in with a wall of external links and gave no way to tell
 * them apart. A tool qualifies when its homepage host is frc.tools or a
 * subdomain of it, tested in SQL against the homepage link so no column is
 * needed. Ordered by popularity, same as its neighbours.
 */
export async function getFirstPartyTools(limit = 6): Promise<ToolListRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .where(
      and(
        eq(tools.status, 'published'),
        // Our own tools should still be alive to be worth featuring.
        ALIVE_ENOUGH_TO_RECOMMEND,
        sql`exists (
          select 1 from ${toolLinks} tl
          where tl.tool_id = ${tools.id}
            and tl.link_type = 'homepage'
            and tl.url ~* '^https?://([a-z0-9-]+\\.)*frc\\.tools([/:?#]|$)'
        )`,
      ),
    )
    .orderBy(desc(tools.popularityScore))
    .limit(limit)
  return enrichTools(rows)
}

export async function getRecentlyUpdatedTools(limit = 6): Promise<ToolListRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .where(and(eq(tools.status, 'published'), sql`${tools.lastActivityAt} is not null`))
    .orderBy(desc(tools.lastActivityAt))
    .limit(limit)
  return enrichTools(rows)
}

export async function getRookieFriendlyTools(limit = 6): Promise<ToolListRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .where(
      and(
        eq(tools.status, 'published'),
        eq(tools.isRookieFriendly, true),
        // A rookie cannot tell a dead tool from a live one, and this row is us
        // telling them where to start.
        ALIVE_ENOUGH_TO_RECOMMEND,
      ),
    )
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
export async function getFavoriteTools(limit = 6): Promise<ToolListRow[]> {
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
  tools: ToolListRow[]
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

export async function getOfficialTools(limit = 6): Promise<ToolListRow[]> {
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
