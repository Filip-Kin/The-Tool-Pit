import { sql, eq, and, isNotNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { tools } from '@the-tool-pit/db'
import { searchTools } from '@/lib/search/search'
import type { SearchResponse } from '@/lib/search/search'

export type RobotCodeProgram = 'frc' | 'ftc' | 'fll'
export interface RobotCodeEntry { year: number | null; slug: string }
export interface RobotCodeTeam { teamNumber: number; code: RobotCodeEntry[]; cad: RobotCodeEntry[] }

/**
 * Team-centric view of the archive: one row per team (numerical order), each carrying the
 * years for which we have that team's code and/or CAD, scoped to a single program. Each
 * (team, kind, year) collapses to the highest-popularity tool so a chip links somewhere useful.
 */
export async function getRobotCodeTeams(program: RobotCodeProgram = 'frc'): Promise<RobotCodeTeam[]> {
  const db = getDb()
  const rows = await db
    .select({
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

  type Slot = { year: number | null; slug: string; pop: number }
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
      if (!existing || pop > existing.pop) entry[kind].set(key, { year: r.seasonYear ?? null, slug: r.slug, pop })
    }
  }

  const sortYears = (m: Map<string, Slot>): RobotCodeEntry[] =>
    [...m.values()]
      .sort((a, b) => (b.year ?? -1) - (a.year ?? -1))
      .map(({ year, slug }) => ({ year, slug }))

  return [...teams.entries()]
    .map(([teamNumber, e]) => ({ teamNumber, code: sortYears(e.code), cad: sortYears(e.cad) }))
    .sort((a, b) => a.teamNumber - b.teamNumber)
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
