import { describe, it, expect } from 'vitest'
import {
  isArchivedListing,
  partitionBySeason,
  seasonsPresent,
  seasonRangeLabel,
  eventTiming,
} from '@/lib/events/event-display'
import type { PublicEvent } from '@/lib/events/event-display'

/**
 * Season filtering on the offseason events explorer.
 *
 * The thing under test is that SEASON AND TIMING ARE TWO DIFFERENT AXES, which
 * is the distinction the UI exists to keep straight:
 *
 *   SEASON  which year's offseason a listing belongs to. The offseason ends on
 *           31 December, so on 1 January the whole of last year drops out of
 *           the default view in one step.
 *   TIMING  whether that listing's weekend has been and gone. This is what the
 *           Upcoming / Already run / All control switches, and it only ever
 *           means "among the listings on screen".
 *
 * An event that ran last September is PAST inside its own season AND becomes
 * ARCHIVED when the year turns. Both facts are true at once and neither
 * implies the other, which is why the two are tested against each other below.
 */

// #region fixtures

function ev(over: Partial<PublicEvent> & { id: string }): PublicEvent {
  return {
    program: 'frc',
    name: over.id,
    hostTeamNumber: null,
    latitude: 43,
    longitude: -84,
    venueName: null,
    address: null,
    city: null,
    region: null,
    country: null,
    seasonYear: null,
    previousListingId: null,
    startDate: null,
    endDate: null,
    days: null,
    parallelDivisions: false,
    capacity: null,
    costUsd: null,
    costNote: null,
    registrationStatus: 'unknown',
    registrationOpensAt: null,
    volunteerStatus: 'unknown',
    eventStatus: 'confirmed',
    website: null,
    registrationUrl: null,
    volunteerUrl: null,
    chiefDelphiUrl: null,
    contactEmail: null,
    notes: null,
    tbaKey: null,
    registeredTeamCount: null,
    teamCountUpdatedAt: null,
    ...over,
  }
}

/** Kettering Kickoff, the 2026 seeded listing, ran 12 September 2026. */
const KETTERING = ev({ id: 'kettering', seasonYear: 2026, startDate: '2026-09-12' })
/** Bot Bash, the last 2026 event, ran 31 October 2026. */
const BOT_BASH = ev({ id: 'bot-bash', seasonYear: 2026, startDate: '2026-10-31' })
/** A 2027 renewal of Bot Bash, not yet run. */
const BOT_BASH_2027 = ev({
  id: 'bot-bash-2027',
  seasonYear: 2027,
  startDate: '2027-10-30',
  previousListingId: 'bot-bash',
})
/** Announced with no dates yet, so no season could be read off it. */
const UNDATED = ev({ id: 'undated', seasonYear: null })

// #endregion

describe('isArchivedListing', () => {
  it('leaves this season alone, including the events that have already run', () => {
    // Mid-season, in November 2026. Bot Bash has happened, and it is still a
    // 2026 listing on the 2026 map.
    expect(isArchivedListing(BOT_BASH, 2026)).toBe(false)
    expect(isArchivedListing(KETTERING, 2026)).toBe(false)
  })

  it('archives the whole of last season the moment the year turns', () => {
    expect(isArchivedListing(BOT_BASH, 2027)).toBe(true)
    expect(isArchivedListing(KETTERING, 2027)).toBe(true)
  })

  it('never archives a listing with no season yet', () => {
    // No dates means nobody has said when it is. Hiding it would lose it.
    expect(isArchivedListing(UNDATED, 2027)).toBe(false)
    expect(isArchivedListing(UNDATED, 2030)).toBe(false)
  })

  it('keeps a listing already dated into a later season on the map', () => {
    expect(isArchivedListing(BOT_BASH_2027, 2026)).toBe(false)
  })
})

describe('season and timing are different axes', () => {
  const november2026 = new Date('2026-11-15T12:00:00')
  const january2027 = new Date('2027-01-15T12:00:00')

  it('an event can be past within a season that is still running', () => {
    // Bot Bash ran on 31 October. In November it is Past on the Already-run
    // tab and it is NOT archived, because 2026 is still the current season.
    expect(eventTiming(BOT_BASH, november2026)).toBe('past')
    expect(isArchivedListing(BOT_BASH, 2026)).toBe(false)
  })

  it('the same event is both past and archived once the year turns', () => {
    expect(eventTiming(BOT_BASH, january2027)).toBe('past')
    expect(isArchivedListing(BOT_BASH, 2027)).toBe(true)
  })

  it('an upcoming event is never archived, whatever its dates say', () => {
    expect(eventTiming(BOT_BASH_2027, january2027)).toBe('upcoming')
    expect(isArchivedListing(BOT_BASH_2027, 2027)).toBe(false)
  })
})

describe('partitionBySeason', () => {
  const all = [KETTERING, BOT_BASH, BOT_BASH_2027, UNDATED]

  it('splits into exactly two groups with nothing lost between them', () => {
    // Exhaustive and non-overlapping is the property that matters: a published
    // listing that fell into neither view would be unreachable from the map.
    const { current, earlier } = partitionBySeason(all, 2027)
    expect(current.length + earlier.length).toBe(all.length)
    const ids = [...current, ...earlier].map((e) => e.id).sort()
    expect(ids).toEqual(['bot-bash', 'bot-bash-2027', 'kettering', 'undated'])
  })

  it('shows this season, next season and the undated one by default', () => {
    const { current } = partitionBySeason(all, 2027)
    expect(current.map((e) => e.id).sort()).toEqual(['bot-bash-2027', 'undated'])
  })

  it('holds last season back behind the earlier-years view', () => {
    const { earlier } = partitionBySeason(all, 2027)
    expect(earlier.map((e) => e.id).sort()).toEqual(['bot-bash', 'kettering'])
  })

  it('hides nothing at all while the season it belongs to is running', () => {
    // In 2026 the 16 seeded listings are the map, whether or not they have run.
    const { current, earlier } = partitionBySeason([KETTERING, BOT_BASH], 2026)
    expect(current).toHaveLength(2)
    expect(earlier).toHaveLength(0)
  })
})

describe('seasonsPresent', () => {
  it('names the years actually on screen, newest first', () => {
    expect(seasonsPresent([BOT_BASH, BOT_BASH_2027, KETTERING])).toEqual([2027, 2026])
  })

  it('skips a listing with no season rather than showing a blank year', () => {
    expect(seasonsPresent([UNDATED, BOT_BASH])).toEqual([2026])
    expect(seasonsPresent([UNDATED])).toEqual([])
  })
})

describe('seasonRangeLabel', () => {
  it('reads as a sentence for one, two, and many years', () => {
    expect(seasonRangeLabel([2026])).toBe('2026')
    expect(seasonRangeLabel([2026, 2025])).toBe('2026 and 2025')
    expect(seasonRangeLabel([2026, 2025, 2024, 2023])).toBe('2026 to 2023')
  })

  it('says nothing when there is no year to say', () => {
    expect(seasonRangeLabel([])).toBe('')
  })
})
