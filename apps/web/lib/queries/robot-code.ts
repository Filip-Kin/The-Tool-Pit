import { sql, eq, and } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { tools } from '@the-tool-pit/db'
import { searchTools } from '@/lib/search/search'
import type { SearchResponse } from '@/lib/search/search'

export async function getRobotCodeTools(filters: {
  program?: string
  seasonYear?: number
  teamNumber?: number
  page?: number
}): Promise<SearchResponse> {
  return searchTools({
    query: '',
    isTeamCode: true,
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
    .where(and(eq(tools.isTeamCode, true), eq(tools.status, 'published'), sql`${tools.seasonYear} is not null`))
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
    .where(and(eq(tools.isTeamCode, true), eq(tools.status, 'published')))

  return {
    totalRepos: row?.totalRepos ?? 0,
    totalTeams: row?.totalTeams ?? 0,
    totalYears: row?.totalYears ?? 0,
  }
}
