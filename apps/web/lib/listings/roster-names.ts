import type { RosterTeam } from '@the-tool-pit/db'

/** A cached team's display strings, both nullable, as getTeamNames hands them back. */
export interface CachedTeamName {
  nickname: string | null
  name: string | null
}

/**
 * Fill missing team names on a roster from the team-name cache.
 *
 * The rule, in one place so the route and its test cannot drift:
 *
 *  - A name the SNAPSHOT already carries wins. It was scraped off the event's
 *    own page, which is what that event chose to call the team, so the cache
 *    never writes over it.
 *  - A team with no name (empty or missing) takes the cache's name: the
 *    nickname first ("Miracle Workerz"), the long name only if there is no
 *    nickname.
 *  - A team the cache has never seen keeps no name. The roster render already
 *    tolerates a bare number.
 *
 * Pure and allocation-light: a team that needs nothing is returned unchanged.
 */
export function mergeRosterNames(
  teams: RosterTeam[],
  cache: Map<number, CachedTeamName>,
): RosterTeam[] {
  return teams.map((team) => {
    const scraped = team.name?.trim()
    if (scraped) return team

    const cached = cache.get(team.number)
    if (!cached) return team

    const filled = cached.nickname?.trim() || cached.name?.trim()
    if (!filled) return team

    return { ...team, name: filled }
  })
}
