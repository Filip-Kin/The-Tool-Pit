import { sql, and, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { tools, toolPrograms, toolLinks, toolVotes, programs, TOOL_TYPE_WEIGHTS } from '@the-tool-pit/db'
import type { SearchParams } from '@the-tool-pit/types'
import { parseSearchSort } from './sort'
import { searchOrderBy } from './order-by'

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
 * This runs entirely in Postgres. The ranking formula, and every term in it is
 * defined in full further down this file:
 *
 *   score = ts_rank_cd                                    (relevance, unweighted)
 *         + exact_title_boost      0.5 on an exact name match
 *         + program_boost          0.4 when a program filter is active
 *         + freshness_score        active 0.25, stale 0.05, unknown 0.1,
 *                                  archived -0.1, inactive -0.35
 *         + official_boost         0.3
 *         + popularity_norm        up to 0.35, log scaled
 *         + type_weight            up to 0.15
 *         + team_artifact_penalty  -0.25 unless a team filter is active
 *
 * POPULARITY IS NOT DECAYED HERE, and that is deliberate rather than an
 * oversight. The Popular row multiplies a listing's score by a seasonal decay
 * (see lib/ranking/seasonal-decay.ts). Search does not, for two reasons. Age is
 * already represented in this formula, additively, by freshness_score, so
 * multiplying popularity by decay as well would count it twice and quietly
 * demote WPILib on a search for "wpilib". And it would not be felt anyway: the
 * popularity term is log scaled over ln(1300), so halving a listing's score
 * moves it by ln(2)/7.2 * 0.35, which is 0.034 points against relevance scores
 * that range over half a point.
 *
 * The popularity weight stays at 0.35 for the same reason. Measured against
 * production on "scouting", "swerve", "vision", "path planning" and
 * "dashboard", relevance leads every one of them today, and raising the weight
 * to 0.5 changes at most two adjacent places on any of those queries. What
 * limits popularity's usefulness in search is not its weight, it is that the
 * input was wrong: four of the fifty results across those queries scored zero
 * because nobody had ever counted their stars or their forum likes. That is
 * what the daily popularity refresh fixes, and it improves search without
 * anyone touching a coefficient.
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

  // Freshness. An inactive listing is PENALISED, not merely unrewarded, which is the
  // difference between "does not get a bonus" and "does not lead the page".
  // Searching "scouting" put a tool nobody had touched in three years first,
  // ahead of maintained ones with twice the upvotes, because an exact title
  // match plus a zero freshness score still beat everything.
  //
  // 'unknown' sits just above stale on purpose: it means we have not checked,
  // usually because there is no repo to check, and a resource with no commit
  // history is not the same thing as a dead project.
  const freshnessScore = sql<number>`case
    when ${tools.freshnessState} in ('active', 'evergreen', 'seasonal') then 0.25
    when ${tools.freshnessState} = 'stale' then 0.05
    -- Archived is a lighter penalty than inactive, because it is a different
    -- fact. Inactive means nobody has touched it in two years. Archived means a
    -- maintainer deliberately closed the repo, which for FRC usually means the
    -- work finished or moved: wpilibsuite/PathWeaver is archived and still
    -- ships with WPILib. Burying that at -0.35 hid an official tool.
    when ${tools.freshnessState} = 'archived' then -0.1
    when ${tools.freshnessState} = 'inactive' then -0.35
    else 0.1
  end`

  // Official boost
  const officialBoost = sql<number>`case when ${tools.isOfficial} then 0.3 else 0 end`

  // Popularity, on a LOG scale.
  //
  // The old formula divided by 1000, which assumed a range this data does not
  // have: the median published tool scores 0, the 90th percentile is 14 and
  // only the 99th reaches 253. That made a 14-upvote tool worth 0.004, so
  // upvotes may as well not have been in the formula at all, and the whole
  // ranking came down to text match.
  //
  // A log curve puts the difference where it is actually felt, between 5 and 50,
  // rather than between 500 and 1000 where almost nothing sits. Divided by
  // ln(1300), the current maximum, so the best tool scores about 1.
  const popularityNorm = sql<number>`least(ln(1 + greatest(${tools.popularityScore}, 0)) / 7.2, 1.0) * 0.35`

  // Type weight boost — preferred tool types rank higher.
  //
  // Built from TOOL_TYPE_WEIGHTS rather than typed out again. This was a second
  // hand-written copy of that map and the two had already drifted: the map gave
  // an off-season event 0.3 and this CASE had no arm for it, so it took the 0.5
  // default and outranked every 'resource' in the catalogue.
  //
  // The values are our own constants, never anything a visitor sends.
  const typeWeightExpr = sql<number>`case ${tools.toolType} ${sql.join(
    Object.entries(TOOL_TYPE_WEIGHTS).map(
      ([type, weight]) => sql`when ${type} then ${weight}`,
    ),
    sql` `,
  )} else 0.5 end * 0.15`

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

  // Parsed here as well as at the page, so no caller can put a value the ORDER
  // BY does not know into a query. lib/search/sort.ts owns the values,
  // lib/search/order-by.ts the clause.
  const orderBy = searchOrderBy(parseSearchSort(sort), rankScore)

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
