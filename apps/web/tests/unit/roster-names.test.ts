/**
 * The rule that turns a roster of bare numbers into named teams.
 *
 * A scraped roster carries numbers only. The team-name cache (The Blue Alliance)
 * is the source of names, always, so the label for a team is the same across the
 * directory. This pins the outcomes the route depends on: the cache name
 * overrides whatever the snapshot held, a team the cache never saw keeps its own
 * name (a manual entry) or none.
 */
import { describe, it, expect } from 'bun:test'
import { mergeRosterNames, type CachedTeamName } from '@/lib/listings/roster-names'
import type { RosterTeam } from '@the-tool-pit/db'

function cacheOf(entries: Array<[number, CachedTeamName]>): Map<number, CachedTeamName> {
  return new Map(entries)
}

describe('mergeRosterNames', () => {
  it('overrides a snapshot name with the cache name (TBA is authoritative)', () => {
    const teams: RosterTeam[] = [{ number: 217, name: 'ThunderChickens (scraped)' }]
    const cache = cacheOf([[217, { nickname: 'The Thunderchickens', name: 'General Motors / …' }]])
    const [out] = mergeRosterNames(teams, cache)
    expect(out.name).toBe('The Thunderchickens')
  })

  it('keeps a manual name when the cache has never seen the team', () => {
    const teams: RosterTeam[] = [{ number: 99999, name: 'Brand New Team' }]
    const [out] = mergeRosterNames(teams, cacheOf([]))
    expect(out.name).toBe('Brand New Team')
  })

  it('fills a missing name from the cache, preferring the nickname', () => {
    const teams: RosterTeam[] = [{ number: 48 }]
    const cache = cacheOf([[48, { nickname: 'Delphi E.L.I.T.E.', name: 'Delphi and Delta College' }]])
    const [out] = mergeRosterNames(teams, cache)
    expect(out.name).toBe('Delphi E.L.I.T.E.')
  })

  it('falls back to the long name when the cache has no nickname', () => {
    const teams: RosterTeam[] = [{ number: 144 }]
    const cache = cacheOf([[144, { nickname: null, name: 'Full Metal Robotics' }]])
    const [out] = mergeRosterNames(teams, cache)
    expect(out.name).toBe('Full Metal Robotics')
  })

  it('leaves a team the cache has never seen without a name', () => {
    const teams: RosterTeam[] = [{ number: 379 }]
    const [out] = mergeRosterNames(teams, cacheOf([]))
    expect(out.name).toBeUndefined()
  })

  it('leaves a cached team with no usable strings without a name', () => {
    const teams: RosterTeam[] = [{ number: 999 }]
    const cache = cacheOf([[999, { nickname: null, name: null }]])
    const [out] = mergeRosterNames(teams, cache)
    expect(out.name).toBeUndefined()
  })

  it('treats an empty scraped name as missing and fills it', () => {
    const teams: RosterTeam[] = [{ number: 12, name: '   ' }]
    const cache = cacheOf([[12, { nickname: 'Robotomy', name: null }]])
    const [out] = mergeRosterNames(teams, cache)
    expect(out.name).toBe('Robotomy')
  })

  it('does not lose other fields when filling a name', () => {
    const teams: RosterTeam[] = [{ number: 4145, robot: 'B', waitlisted: true, waitlistPosition: 3 }]
    const cache = cacheOf([[4145, { nickname: "WorBots", name: null }]])
    const [out] = mergeRosterNames(teams, cache)
    expect(out).toEqual({ number: 4145, name: 'WorBots', robot: 'B', waitlisted: true, waitlistPosition: 3 })
  })
})
