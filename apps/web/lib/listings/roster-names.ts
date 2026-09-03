import type { RosterTeam } from '@the-tool-pit/db'

/** A cached team's display strings, both nullable, as getTeamNames hands them back. */
export interface CachedTeamName {
  nickname: string | null
  name: string | null
}

/**
 * Set team names on a roster from the team-name cache.
 *
 * The rule, in one place so the route and its test cannot drift: TBA is the
 * source of team names, ALWAYS. A scraper reads a number off an event's page; it
 * does not read the name, because "Team 5086" on one site and "Cadillac
 * Connectors" on The Blue Alliance should not be two different labels across the
 * directory. So:
 *
 *  - A team The Blue Alliance knows takes its cached name, overriding whatever
 *    the snapshot carried: the nickname first ("Miracle Workerz"), the long name
 *    only if there is no nickname.
 *  - A team the cache has never seen (a brand-new number, or a non-FRC entry)
 *    keeps whatever name the snapshot had, which for a manually entered roster is
 *    the one the organiser typed, and otherwise nothing. The render tolerates a
 *    bare number.
 *
 * Pure and allocation-light: a team already showing its cache name is returned
 * unchanged.
 */
export function mergeRosterNames(
  teams: RosterTeam[],
  cache: Map<number, CachedTeamName>,
): RosterTeam[] {
  return teams.map((team) => {
    const scraped = team.name?.trim()
    const cached = cache.get(team.number)
    const fromTba = cached ? cached.nickname?.trim() || cached.name?.trim() : undefined

    // 9970-9999 are PLACEHOLDER numbers (a pre-rookie, a name-only team we
    // assigned one). TBA's label for them is a generic "Off-Season Demo Team
    // 9970", so the name off the event's own site is the real one and wins here;
    // TBA is only the last resort.
    if (team.number >= 9970 && team.number <= 9999) {
      const name = scraped || fromTba
      return name && team.name !== name ? { ...team, name } : team
    }

    // A normal team: The Blue Alliance is authoritative.
    if (fromTba) return team.name === fromTba ? team : { ...team, name: fromTba }

    // TBA has never seen this number (a brand-new team): keep the scraped/manual
    // name, or nothing.
    return team
  })
}
