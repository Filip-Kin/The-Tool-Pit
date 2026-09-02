/**
 * A season is not a duplicate of another season.
 *
 * The ingest pipeline dropped a candidate whose name scored above 0.7 against
 * anything already published. "1511 2023 Robot Code" and "1511 2026 Robot Code"
 * score 0.826, so the Robot Code Archive could not take a new season for a team
 * it already held, and said nothing when it refused. Same for CAD. 252 of 309
 * published team-code listings had a sibling inside that band.
 */
import { describe, it, expect } from 'bun:test'
import {
  DUPLICATE_NAME_SIMILARITY,
  definitelyDifferentListings,
  identityFromName,
  seasonYearFromName,
  teamNumberFromName,
} from '@the-tool-pit/db'

describe('reading a team and a season off a listing name', () => {
  it.each([
    ['1511 2023 Robot Code', 1511, 2023],
    ['3407 2023 Robot Code', 3407, 2023],
    ['24 2024 Robot Code', 24, 2024],
    ['Team 254 2024 Robot Code', 254, 2024],
    ['frc971 2019 Robot Code', 971, 2019],
    ['10298 2017 Robot Code', 10298, 2017],
  ])('reads %s', (name, team, season) => {
    expect(teamNumberFromName(name)).toBe(team)
    expect(seasonYearFromName(name)).toBe(season)
  })

  it('reads a team whose number is also a plausible season', () => {
    // Team 2023 exists. The archive writes the team first and the season
    // second, which is the only thing that tells these two numbers apart.
    expect(identityFromName('2023 2024 Robot Code')).toEqual({ teamNumber: 2023, seasonYear: 2024 })
  })

  it('does not invent a team from a bare season', () => {
    expect(teamNumberFromName('2024 Robot Code')).toBeNull()
    expect(seasonYearFromName('2024 Robot Code')).toBe(2024)
  })

  it('says nothing about a name that carries neither', () => {
    expect(identityFromName('AdvantageScope')).toEqual({ teamNumber: null, seasonYear: null })
    // A version number is not a season.
    expect(seasonYearFromName('PathPlanner 2.1')).toBeNull()
  })
})

describe('definitely different listings', () => {
  it('separates two seasons of one team', () => {
    expect(
      definitelyDifferentListings(
        identityFromName('1511 2023 Robot Code'),
        identityFromName('1511 2026 Robot Code'),
      ),
    ).toBe(true)
  })

  it('separates two teams in one season', () => {
    expect(
      definitelyDifferentListings(
        identityFromName('3407 2023 Robot Code'),
        identityFromName('3405 2023 Robot Code'),
      ),
    ).toBe(true)
  })

  it('does not separate the same team and season', () => {
    // The real duplicate case, and production holds three copies of
    // "34 2017 Robot Code" today. This has to stay catchable.
    expect(
      definitelyDifferentListings(
        identityFromName('34 2017 Robot Code'),
        identityFromName('34 2017 Robot Code'),
      ),
    ).toBe(false)
  })

  it('stays quiet when either side is unknown', () => {
    // Only ever answers "definitely different". A wrong "different" costs a
    // duplicate row a moderator merges. A wrong "same" deletes a season nobody
    // knows is missing.
    expect(
      definitelyDifferentListings({ teamNumber: 1511, seasonYear: 2023 }, { teamNumber: null, seasonYear: null }),
    ).toBe(false)
    expect(
      definitelyDifferentListings({ teamNumber: null, seasonYear: 2023 }, { teamNumber: 1511, seasonYear: null }),
    ).toBe(false)
  })
})

describe('the threshold', () => {
  it('is one number, and it is the one the review panel used', () => {
    expect(DUPLICATE_NAME_SIMILARITY).toBe(0.85)
  })

  it('sits above the score that was eating seasons', () => {
    // similarity('1511 2023 Robot Code', '1511 2026 Robot Code') = 0.826 in
    // production. The identity rule is the real guard; this is the backstop.
    expect(DUPLICATE_NAME_SIMILARITY).toBeGreaterThan(0.826)
  })
})
