import { describe, it, expect } from 'vitest'
import {
  countedMonths,
  seasonalDecay,
  DECAY_HALF_LIFE_MONTHS,
  UNKNOWN_ACTIVITY_MULTIPLIER,
} from '@/lib/ranking/seasonal-decay'

/**
 * The curve behind the Popular row.
 *
 * The cases below are the behaviour that was asked for, not a transcription of
 * the implementation: a quiet FIRST summer costs a listing nothing, autumn
 * silence starts to cost it, a listing that misses a whole season pays half,
 * and the tools that lead the page do not move.
 */

const utc = (y: number, m: number, d = 15) => new Date(Date.UTC(y, m - 1, d))

describe('countedMonths', () => {
  it('counts September through April and nothing else', () => {
    // One counted year, September to September, is eight months.
    expect(countedMonths(utc(2027, 9)) - countedMonths(utc(2026, 9))).toBe(8)
  })

  it('gives every day of the summer the same reading', () => {
    // This is the whole point. May, June, July and August are one frozen
    // instant as far as the ranking is concerned.
    const may = countedMonths(utc(2026, 5, 1))
    expect(countedMonths(utc(2026, 6, 30))).toBe(may)
    expect(countedMonths(utc(2026, 7, 4))).toBe(may)
    expect(countedMonths(utc(2026, 8, 31))).toBe(may)
    // September starts the clock again at the same reading, then moves.
    expect(countedMonths(utc(2026, 9, 1))).toBe(may)
    expect(countedMonths(utc(2026, 10, 1))).toBe(may + 1)
  })

  it('never goes backwards', () => {
    let previous = -Infinity
    for (let year = 2024; year <= 2027; year++) {
      for (let month = 1; month <= 12; month++) {
        const value = countedMonths(utc(year, month))
        expect(value).toBeGreaterThanOrEqual(previous)
        previous = value
      }
    }
  })
})

describe('seasonalDecay', () => {
  it('leaves a listing touched this month alone', () => {
    expect(seasonalDecay(utc(2026, 8, 20), utc(2026, 9, 1))).toBe(1)
  })

  it('charges a quiet summer nothing', () => {
    // A repo last pushed in April, seen in May and again at the end of August.
    // FRC is finished for the year and FTC has not started. Same number.
    const inMay = seasonalDecay(utc(2026, 4, 10), utc(2026, 5, 20))
    const inAugust = seasonalDecay(utc(2026, 4, 10), utc(2026, 8, 31))
    expect(inAugust).toBe(inMay)
    // And the charge for that April-to-August gap is close to nothing.
    expect(inAugust).toBeGreaterThan(0.9)
  })

  it('starts charging through the autumn', () => {
    // The same repo, still silent, once the seasons are running again.
    const april = utc(2026, 4, 10)
    expect(seasonalDecay(april, utc(2026, 9, 1))).toBeGreaterThan(0.9)
    expect(seasonalDecay(april, utc(2026, 12, 1))).toBeLessThan(0.8)
    expect(seasonalDecay(april, utc(2027, 2, 1))).toBeLessThan(0.65)
  })

  it('halves a listing that has missed a whole season', () => {
    // Silent from one April to the next is a season nobody showed up for.
    expect(seasonalDecay(utc(2026, 4, 10), utc(2027, 4, 30))).toBeCloseTo(0.5, 1)
  })

  it('halves again over the season after that', () => {
    const oneSeason = seasonalDecay(utc(2026, 4, 10), utc(2027, 4, 30))
    const twoSeasons = seasonalDecay(utc(2026, 4, 10), utc(2028, 4, 30))
    expect(twoSeasons).toBeCloseTo(oneSeason / 2, 2)
  })

  it('never rewards a future date or goes above 1', () => {
    expect(seasonalDecay(utc(2027, 3, 1), utc(2026, 9, 1))).toBe(1)
  })

  it('holds an unknown last activity flat instead of decaying it', () => {
    // 478 of 1094 published listings have no lastActivityAt. That is the
    // absence of a repo to check, not evidence that anything is dead.
    expect(seasonalDecay(null, utc(2026, 9, 1))).toBe(UNKNOWN_ACTIVITY_MULTIPLIER)
    expect(seasonalDecay(undefined, utc(2030, 9, 1))).toBe(UNKNOWN_ACTIVITY_MULTIPLIER)
  })

  it('puts the half life exactly one counted year out', () => {
    const now = utc(2026, 9, 1)
    // A whole calendar year back is a whole counted year back: the summer in
    // between contributes nothing either way.
    const oneCountedYearAgo = utc(2025, 9, 1)
    expect(countedMonths(now) - countedMonths(oneCountedYearAgo)).toBe(DECAY_HALF_LIFE_MONTHS)
    expect(seasonalDecay(oneCountedYearAgo, now)).toBeCloseTo(0.5, 5)
  })
})

describe('the canon does not move', () => {
  /**
   * The real top of Popular, with the star counts and last-activity months read
   * off production. Decay is allowed to reorder the middle. It is not allowed
   * to reorder these.
   */
  const CANON = [
    { name: 'WPILib', score: 1301, lastActivity: utc(2026, 8) },
    { name: 'dyn4j', score: 538, lastActivity: utc(2026, 7) },
    { name: 'Autodesk Inventor Tool', score: 497, lastActivity: utc(2026, 8) },
    { name: 'PathPlanner', score: 490, lastActivity: utc(2026, 8) },
    { name: 'PhotonVision', score: 424, lastActivity: utc(2026, 9) },
    { name: 'controls engineering in frc', score: 372, lastActivity: utc(2026, 8) },
    { name: 'AdvantageScope', score: 285, lastActivity: utc(2026, 8) },
    { name: 'GradleRIO', score: 283, lastActivity: utc(2026, 8) },
  ]

  it('keeps the top of the page in the same order', () => {
    const now = utc(2026, 9, 1)
    const ranked = [...CANON]
      .sort((a, b) => b.score * seasonalDecay(b.lastActivity, now) - a.score * seasonalDecay(a.lastActivity, now))
      .map((t) => t.name)
    expect(ranked).toEqual(CANON.map((t) => t.name))
  })

  it('does not let a quiet listing overtake a maintained one on decay alone', () => {
    // Road Runner, 268 and quiet since November 2025, sat ninth and belongs
    // below AdvantageKit at 255, which is current. That is the reorder the
    // curve is for.
    const now = utc(2026, 9, 1)
    const roadRunner = 268 * seasonalDecay(utc(2025, 11), now)
    const advantageKit = 255 * seasonalDecay(utc(2026, 8), now)
    expect(roadRunner).toBeLessThan(advantageKit)
    // But it must not vanish. It is still a well-liked library.
    expect(roadRunner).toBeGreaterThan(100)
  })
})
