import { sql, eq, and, isNotNull, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { tools, toolLinks } from '@the-tool-pit/db'
import { searchTools } from '@/lib/search/search'
import type { SearchResponse } from '@/lib/search/search'

export type RobotCodeProgram = 'frc' | 'ftc' | 'fll'
/**
 * `url` is where the resource actually lives: the GitHub repo for code, the
 * Chief Delphi thread or the Onshape/GrabCAD page for CAD. Null when a tool has
 * no outbound link, in which case the chip falls back to the /tools page.
 */
export interface RobotCodeEntry { year: number | null; slug: string; url: string | null }
export interface RobotCodeTeam {
  teamNumber: number
  code: RobotCodeEntry[]
  cad: RobotCodeEntry[]
  /** Newest season across code and CAD. Null only when nothing carries a year. */
  latestYear: number | null
}

/**
 * Team-centric view of the archive: one row per team, each carrying the years
 * for which we have that team's code and/or CAD, scoped to a single program.
 * Each (team, kind, year) collapses to the highest-popularity tool so a chip
 * links somewhere useful.
 *
 * Ordered by NEWEST SEASON first, then team number. Plain team-number order put
 * a team whose only upload is 2019 CAD above one with this season's code, which
 * buries everything current behind a long tail of archive rows.
 */
export async function getRobotCodeTeams(program: RobotCodeProgram = 'frc'): Promise<RobotCodeTeam[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: tools.id,
      teamNumber: tools.teamNumber,
      seasonYear: tools.seasonYear,
      isTeamCode: tools.isTeamCode,
      isTeamCad: tools.isTeamCad,
      slug: tools.slug,
      popularityScore: tools.popularityScore,
    })
    .from(tools)
    .where(and(
      eq(tools.status, 'published'),
      isNotNull(tools.teamNumber),
      sql`(${tools.isTeamCode} or ${tools.isTeamCad})`,
      sql`exists (select 1 from tool_programs tp join programs p on p.id = tp.program_id where tp.tool_id = ${tools.id} and p.slug = ${program})`,
    ))
    .orderBy(tools.teamNumber)

  type Slot = { year: number | null; slug: string; pop: number; toolId: string; url: string | null }
  const teams = new Map<number, { code: Map<string, Slot>; cad: Map<string, Slot> }>()

  for (const r of rows) {
    const team = r.teamNumber as number
    let entry = teams.get(team)
    if (!entry) { entry = { code: new Map(), cad: new Map() }; teams.set(team, entry) }
    const kinds: ('code' | 'cad')[] = []
    if (r.isTeamCode) kinds.push('code')
    if (r.isTeamCad) kinds.push('cad')
    if (kinds.length === 0) kinds.push('cad')
    for (const kind of kinds) {
      const key = String(r.seasonYear ?? 'null')
      const pop = r.popularityScore ?? 0
      const existing = entry[kind].get(key)
      if (!existing || pop > existing.pop) entry[kind].set(key, { year: r.seasonYear ?? null, slug: r.slug, pop, toolId: r.id, url: null })
    }
  }

  // Attach the outbound URL each chip should point at. Only the tools that
  // survived the popularity collapse need links, so gather those ids and fetch
  // in one query. Kind decides priority: code prefers its GitHub repo, CAD
  // prefers the thread or CAD host it was found on.
  const winners = [...teams.values()].flatMap((e) => [...e.code.values(), ...e.cad.values()])
  const ids = [...new Set(winners.map((s) => s.toolId))]
  const linksByTool = new Map<string, Map<string, string>>()
  if (ids.length) {
    const linkRows = await db
      .select({ toolId: toolLinks.toolId, linkType: toolLinks.linkType, url: toolLinks.url })
      .from(toolLinks)
      .where(inArray(toolLinks.toolId, ids))
    for (const l of linkRows) {
      let byType = linksByTool.get(l.toolId)
      if (!byType) { byType = new Map(); linksByTool.set(l.toolId, byType) }
      // First of a type wins; the pipeline writes one row per auto-managed type.
      if (!byType.has(l.linkType)) byType.set(l.linkType, l.url)
    }
  }
  const pickUrl = (kind: 'code' | 'cad', toolId: string): string | null => {
    const byType = linksByTool.get(toolId)
    if (!byType) return null
    const order = kind === 'code' ? ['github', 'homepage', 'forum'] : ['forum', 'homepage', 'github']
    for (const t of order) { const u = byType.get(t); if (u) return u }
    return null
  }
  for (const e of teams.values()) {
    for (const s of e.code.values()) s.url = pickUrl('code', s.toolId)
    for (const s of e.cad.values()) s.url = pickUrl('cad', s.toolId)
  }

  const sortYears = (m: Map<string, Slot>): RobotCodeEntry[] =>
    [...m.values()]
      .sort((a, b) => (b.year ?? -1) - (a.year ?? -1))
      .map(({ year, slug, url }) => ({ year, slug, url }))

  return [...teams.entries()]
    .map(([teamNumber, e]) => {
      const code = sortYears(e.code)
      const cad = sortYears(e.cad)
      const years = [...code, ...cad].map((x) => x.year).filter((y): y is number => y !== null)
      return { teamNumber, code, cad, latestYear: years.length ? Math.max(...years) : null }
    })
    // Newest season first; within a season, team number ascending. A team with
    // no dated upload at all sorts last rather than to the top, which is what
    // treating null as 0 would do.
    .sort((a, b) => (b.latestYear ?? -1) - (a.latestYear ?? -1) || a.teamNumber - b.teamNumber)
}

export async function getRobotCodeTools(filters: {
  program?: string
  seasonYear?: number
  teamNumber?: number
  page?: number
}): Promise<SearchResponse> {
  return searchTools({
    query: '',
    teamArtifact: true, // team code OR team CAD
    program: filters.program as 'frc' | 'ftc' | 'fll' | undefined,
    seasonYear: filters.seasonYear,
    teamNumber: filters.teamNumber,
    page: filters.page ?? 1,
    pageSize: 24,
    sort: 'popular',
  })
}

export async function getAvailableSeasonYears(): Promise<number[]> {
  const db = getDb()
  const rows = await db
    .selectDistinct({ seasonYear: tools.seasonYear })
    .from(tools)
    .where(and(
      sql`(${tools.isTeamCode} or ${tools.isTeamCad})`,
      eq(tools.status, 'published'),
      sql`${tools.seasonYear} is not null`,
    ))
    .orderBy(sql`${tools.seasonYear} desc nulls last`)

  return rows.map((r) => r.seasonYear as number)
}

export async function getRobotCodeStats(): Promise<{
  totalRepos: number
  totalTeams: number
  totalYears: number
}> {
  const db = getDb()
  const [row] = await db
    .select({
      totalRepos: sql<number>`count(*)::int`,
      totalTeams: sql<number>`count(distinct ${tools.teamNumber})::int`,
      totalYears: sql<number>`count(distinct ${tools.seasonYear})::int`,
    })
    .from(tools)
    .where(and(sql`(${tools.isTeamCode} or ${tools.isTeamCad})`, eq(tools.status, 'published')))

  return {
    totalRepos: row?.totalRepos ?? 0,
    totalTeams: row?.totalTeams ?? 0,
    totalYears: row?.totalYears ?? 0,
  }
}
