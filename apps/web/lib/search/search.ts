import { sql, and, eq, inArray, desc } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { tools, toolPrograms, toolLinks, toolVotes, programs } from '@the-tool-pit/db'
import type { SearchParams } from '@the-tool-pit/types'

// Content-type weights for ranking boost
const TYPE_WEIGHTS: Record<string, number> = {
  web_app: 1.0,
  calculator: 1.0,
  desktop_app: 0.9,
  github_project: 0.85,
  browser_extension: 0.8,
  mobile_app: 0.8,
  api: 0.7,
  spreadsheet: 0.4,
  resource: 0.35,
  other: 0.5,
}

export interface SearchResultRow {
  id: string
  slug: string
  name: string
  summary: string | null
  toolType: string
  isOfficial: boolean
  isVendor: boolean
  isRookieFriendly: boolean
  isTeamCode: boolean
  isTeamCad: boolean
  teamNumber: number | null
  seasonYear: number | null
  freshnessState: string | null
  lastActivityAt: Date | null
  popularityScore: number
  voteCount: number
  programs: string[]
  githubUrl: string | null
}

export interface SearchResponse {
  tools: SearchResultRow[]
  total: number
  page: number
  pageSize: number
}

/**
 * Full-text + trigram search with program-aware ranking boost.
 *
 * This runs entirely in Postgres. The ranking formula:
 *   score = ts_rank * 1.0
 *         + exact_title_boost * 0.5
 *         + program_boost * 0.4 (if program filter active)
 *         + popularity * 0.3
 *         + freshness_decay * 0.2
 *         + official_boost * 0.3
 *         + type_weight * 0.15
 */
export async function searchTools(params: SearchParams): Promise<SearchResponse> {
  const db = getDb()
  const {
    query,
    program,
    toolType,
    audienceRole,
    audienceFunction,
    isOfficial,
    isRookieFriendly,
    seasonYear,
    sort,
    page = 1,
    pageSize = 20,
  } = params

  // These can be rewritten by a "254 code" style team query, so keep them mutable.
  let { isTeamCode, isTeamCad, teamArtifact, teamNumber } = params

  // "254 code" / "1678 cad" / "team 254" → structured team-artifact lookup. The team number
  // rarely appears in a tool's name/summary text, so free-text search alone can't find it;
  // translate the query into a teamNumber + artifact filter instead. Skipped when the caller
  // already set an explicit team filter (e.g. the Robot Code Archive).
  const teamQuery =
    isTeamCode === undefined && isTeamCad === undefined && teamArtifact === undefined && teamNumber === undefined
      ? parseTeamQuery(query)
      : null
  const effectiveQuery = teamQuery ? '' : query
  if (teamQuery) {
    teamNumber = teamQuery.teamNumber
    if (teamQuery.artifact === 'code') isTeamCode = true
    else if (teamQuery.artifact === 'cad') isTeamCad = true
    else teamArtifact = true
  }

  const offset = (page - 1) * pageSize
  const hasQuery = Boolean(effectiveQuery && effectiveQuery.trim())

  // Build the search vector expression
  const searchVector = sql`to_tsvector('english', ${tools.name} || ' ' || coalesce(${tools.summary}, '') || ' ' || coalesce(${tools.description}, ''))`
  const queryVector = hasQuery ? sql`plainto_tsquery('english', ${effectiveQuery})` : null

  // ts_rank score (0 if no query)
  const tsRank = hasQuery && queryVector
    ? sql<number>`ts_rank_cd(${searchVector}, ${queryVector})`
    : sql<number>`0`

  // Exact title boost
  const exactTitleBoost = hasQuery
    ? sql<number>`case when lower(${tools.name}) = lower(${effectiveQuery}) then 0.5 else 0 end`
    : sql<number>`0`

  // Program boost (join-based; done in subquery)
  const programBoostExpr = program
    ? sql<number>`case when exists (
        select 1 from tool_programs tp
        join programs p on p.id = tp.program_id
        where tp.tool_id = ${tools.id} and p.slug = ${program}
      ) then 0.4 else 0 end`
    : sql<number>`0`

  // Freshness decay: 1.0 for active, 0.5 for stale, 0.0 for abandoned
  const freshnessScore = sql<number>`case
    when ${tools.freshnessState} in ('active', 'evergreen', 'seasonal') then 0.2
    when ${tools.freshnessState} = 'stale' then 0.1
    else 0
  end`

  // Official boost
  const officialBoost = sql<number>`case when ${tools.isOfficial} then 0.3 else 0 end`

  // Popularity (normalized 0–1 assuming max score ~1000)
  const popularityNorm = sql<number>`least(${tools.popularityScore} / 1000.0, 1.0) * 0.3`

  // Type weight boost — preferred tool types rank higher
  const typeWeightExpr = sql<number>`case ${tools.toolType}
    when 'web_app' then 1.0 when 'calculator' then 1.0
    when 'desktop_app' then 0.9 when 'github_project' then 0.85
    when 'browser_extension' then 0.8 when 'mobile_app' then 0.8
    when 'api' then 0.7 when 'spreadsheet' then 0.4
    when 'resource' then 0.35 else 0.5 end * 0.15`

  // Team-artifact penalty — demotes team code AND team CAD in general browsing without zeroing
  // them. Disabled whenever the caller is explicitly after team artifacts (a team filter, or a
  // "254 code" query that set one above), so the Robot Code Archive and team searches rank normally.
  const teamFilterActive =
    isTeamCode !== undefined || isTeamCad !== undefined || teamArtifact !== undefined || teamNumber !== undefined
  const teamCodePenalty = teamFilterActive
    ? sql<number>`0`
    : sql<number>`case when ${tools.isTeamCode} or ${tools.isTeamCad} then -0.25 else 0 end`

  const rankScore = sql<number>`(
    ${tsRank} * 1.0
    + ${exactTitleBoost}
    + ${programBoostExpr}
    + ${freshnessScore}
    + ${officialBoost}
    + ${popularityNorm}
    + ${typeWeightExpr}
    + ${teamCodePenalty}
  )`

  // WHERE conditions
  const conditions = [eq(tools.status, 'published')]

  if (hasQuery && queryVector) {
    conditions.push(
      sql`(
        ${searchVector} @@ ${queryVector}
        or ${tools.name} ilike ${'%' + effectiveQuery + '%'}
      )`,
    )
  }

  if (toolType) conditions.push(eq(tools.toolType, toolType))
  if (isOfficial !== undefined) conditions.push(eq(tools.isOfficial, isOfficial))
  if (isRookieFriendly !== undefined) conditions.push(eq(tools.isRookieFriendly, isRookieFriendly))
  if (isTeamCode !== undefined) conditions.push(eq(tools.isTeamCode, isTeamCode))
  if (isTeamCad !== undefined) conditions.push(eq(tools.isTeamCad, isTeamCad))
  if (teamArtifact) conditions.push(sql`(${tools.isTeamCode} or ${tools.isTeamCad})`)
  if (teamNumber !== undefined) conditions.push(eq(tools.teamNumber, teamNumber))
  if (seasonYear !== undefined) conditions.push(eq(tools.seasonYear, seasonYear))

  if (program) {
    conditions.push(
      sql`exists (
        select 1 from tool_programs tp
        join programs p on p.id = tp.program_id
        where tp.tool_id = ${tools.id} and p.slug = ${program}
      )`,
    )
  }

  if (audienceRole) {
    conditions.push(
      sql`exists (
        select 1 from tool_audience_primary_roles tar
        join audience_primary_roles apr on apr.id = tar.role_id
        where tar.tool_id = ${tools.id} and apr.slug = ${audienceRole}
      )`,
    )
  }

  if (audienceFunction) {
    conditions.push(
      sql`exists (
        select 1 from tool_audience_functions taf
        join audience_functions af on af.id = taf.function_id
        where taf.tool_id = ${tools.id} and af.slug = ${audienceFunction}
      )`,
    )
  }

  const where = and(...conditions)

  // Build ORDER BY based on sort param
  const orderBy =
    sort === 'popular'
      ? desc(tools.popularityScore)
      : sort === 'updated'
        ? sql`${tools.lastActivityAt} desc nulls last`
        : sql`${rankScore} desc`

  // Main query — fetch tool IDs ranked by score
  const rankedRows = await db
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      summary: tools.summary,
      toolType: tools.toolType,
      isOfficial: tools.isOfficial,
      isVendor: tools.isVendor,
      isRookieFriendly: tools.isRookieFriendly,
      isTeamCode: tools.isTeamCode,
      isTeamCad: tools.isTeamCad,
      teamNumber: tools.teamNumber,
      seasonYear: tools.seasonYear,
      freshnessState: tools.freshnessState,
      lastActivityAt: tools.lastActivityAt,
      popularityScore: tools.popularityScore,
      githubStars: tools.githubStars,
      chiefDelphiLikes: tools.chiefDelphiLikes,
      score: rankScore,
    })
    .from(tools)
    .where(where)
    .orderBy(orderBy)
    .limit(pageSize)
    .offset(offset)

  if (rankedRows.length === 0) {
    return { tools: [], total: 0, page, pageSize }
  }

  // Fetch programs and GitHub links for returned tools
  const toolIds = rankedRows.map((r) => r.id)

  const [programRows, linkRows, voteCountRows] = await Promise.all([
    db
      .select({
        toolId: toolPrograms.toolId,
        programSlug: programs.slug,
      })
      .from(toolPrograms)
      .innerJoin(programs, eq(programs.id, toolPrograms.programId))
      .where(inArray(toolPrograms.toolId, toolIds)),

    db
      .select({ toolId: toolLinks.toolId, url: toolLinks.url })
      .from(toolLinks)
      .where(
        and(
          inArray(toolLinks.toolId, toolIds),
          eq(toolLinks.linkType, 'github'),
        ),
      ),

    db
      .select({
        toolId: toolVotes.toolId,
        voteCount: sql<number>`count(*)::int`,
      })
      .from(toolVotes)
      .where(inArray(toolVotes.toolId, toolIds))
      .groupBy(toolVotes.toolId),
  ])

  const programsByTool = new Map<string, string[]>()
  for (const row of programRows) {
    const existing = programsByTool.get(row.toolId) ?? []
    existing.push(row.programSlug)
    programsByTool.set(row.toolId, existing)
  }

  const githubByTool = new Map<string, string>()
  for (const row of linkRows) {
    githubByTool.set(row.toolId, row.url)
  }

  const votesByTool = new Map<string, number>()
  for (const row of voteCountRows) {
    votesByTool.set(row.toolId, row.voteCount)
  }

  // Count total matching (for pagination)
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tools)
    .where(where)

  const result: SearchResultRow[] = rankedRows.map((row) => ({
    ...row,
    programs: programsByTool.get(row.id) ?? [],
    githubUrl: githubByTool.get(row.id) ?? null,
    voteCount: (votesByTool.get(row.id) ?? 0) + (row.githubStars ?? 0) + (row.chiefDelphiLikes ?? 0),
    lastActivityAt: row.lastActivityAt ?? null,
    isTeamCode: row.isTeamCode,
    teamNumber: row.teamNumber ?? null,
    seasonYear: row.seasonYear ?? null,
  }))

  return { tools: result, total: count, page, pageSize }
}

// #region team-number query parsing
const TEAM_CODE_WORDS = /\b(code|repo|repos|software|robot\s*code|program|programming|firmware)\b/
const TEAM_CAD_WORDS = /\b(cad|onshape|grabcad|models?|design)\b/

/**
 * Recognise "254 code", "1678 cad", "team 254" style queries and translate them into a
 * structured team-number + artifact lookup. Returns null for ordinary searches — including a
 * bare number with no team intent — so a search for a tool that merely contains digits is not
 * hijacked.
 */
export function parseTeamQuery(q?: string): { teamNumber: number; artifact: 'code' | 'cad' | 'any' } | null {
  if (!q) return null
  const s = q.trim().toLowerCase()

  const numMatch = s.match(/(?:^|\s)(?:team\s*)?(\d{1,5})\b/)
  if (!numMatch) return null
  const teamNumber = parseInt(numMatch[1], 10)
  if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99999) return null

  const cad = TEAM_CAD_WORDS.test(s)
  const code = TEAM_CODE_WORDS.test(s)
  const hasTeamWord = /\bteam\s*\d{1,5}\b/.test(s)

  // Only trigger on clear team intent: an artifact word (code/cad/…), or an explicit "team NNNN".
  if (!cad && !code && !hasTeamWord) return null

  const artifact = cad && !code ? 'cad' : code && !cad ? 'code' : 'any'
  return { teamNumber, artifact }
}
// #endregion
