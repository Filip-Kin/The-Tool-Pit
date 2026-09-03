import { inArray } from 'drizzle-orm'
import { getDb } from './client'
import { teams } from './schema/teams'

/** A cached team's display strings, both nullable. */
export interface CachedTeamName {
  nickname: string | null
  name: string | null
}

/**
 * Look up cached names for a batch of team numbers in ONE query.
 *
 * Returns a Map keyed by team number, holding only the teams the cache knows.
 * A number the cache has never seen is simply absent from the map, so a caller
 * reads `map.get(n)` and treats a miss the same as no name. De-duplicates and
 * drops non-integers before the query, and short-circuits an empty input so an
 * empty roster costs no round trip.
 *
 * Batched on purpose: a roster render collects every number on the card and
 * asks once, never per team.
 */
export async function getTeamNames(numbers: number[]): Promise<Map<number, CachedTeamName>> {
  const wanted = [...new Set(numbers.filter((n) => Number.isInteger(n)))]
  const out = new Map<number, CachedTeamName>()
  if (wanted.length === 0) return out

  const rows = await getDb()
    .select({ number: teams.number, nickname: teams.nickname, name: teams.name })
    .from(teams)
    .where(inArray(teams.number, wanted))

  for (const row of rows) {
    out.set(row.number, { nickname: row.nickname, name: row.name })
  }
  return out
}
