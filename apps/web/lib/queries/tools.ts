import { sql, eq, desc, and, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { tools, toolPrograms, toolLinks, toolVotes, programs, audiencePrimaryRoles, audienceFunctions, toolAudiencePrimaryRoles, toolAudienceFunctions } from '@the-tool-pit/db'
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

export async function getTrendingTools(limit = 6): Promise<SearchResultRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(tools)
    .where(eq(tools.status, 'published'))
    .orderBy(desc(tools.popularityScore))
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
