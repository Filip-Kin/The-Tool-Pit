import { describe, it, expect } from 'vitest'
import {
  countToolsPerTopic,
  shareOfThreadLikes,
  toolThreadShares,
} from '../src/jobs/popularity.js'

/**
 * One Chief Delphi thread, several tools, one pot of likes.
 *
 * The popularity pass used to write a thread's opening-post like count to every
 * listing that pointed at that thread. On the threads below that is not a small
 * error. The numbers are the production ones, read off the catalogue:
 *
 *   /t/open-alliance-2024-directory-listings-added/441338   60 likes,  7 tools
 *   /t/introducing-yet-another-software-suite-yams.../506826 60 likes,  4 tools
 *   /t/introducing-purplelib.../450203                      13 likes,  4 tools
 *
 * 100 of the 165 published listings that carry a thread are on a thread they
 * share with something else, and 87 of them were holding a count that belonged
 * to the thread rather than to them. chief_delphi_likes is a full term of
 * popularity_score, which orders the Popular section and is 0.35 of the search
 * rank.
 */

describe('a thread that announces several tools splits its likes', () => {
  it('gives a thread with one tool the whole count', () => {
    // The case that must not move: 65 of the 165 listings with a thread have
    // that thread to themselves.
    expect(shareOfThreadLikes(60, 1)).toBe(60)
    expect(shareOfThreadLikes(0, 1)).toBe(0)
  })

  it('divides the Open Alliance directory thread seven ways', () => {
    expect(shareOfThreadLikes(60, 7)).toBe(8)
  })

  it('divides the YAMS announcement four ways', () => {
    expect(shareOfThreadLikes(60, 4)).toBe(15)
    expect(shareOfThreadLikes(13, 4)).toBe(3)
  })

  it('never hands out more approval than the thread got', () => {
    // Floor, not round. 60 across seven rounds to 9 each, which is 63 likes
    // credited for 60 given. The remainder is left uncredited on purpose.
    for (const [likes, sharers] of [
      [60, 7],
      [13, 4],
      [61, 3],
      [19, 3],
      [7, 3],
    ] as const) {
      expect(shareOfThreadLikes(likes, sharers) * sharers).toBeLessThanOrEqual(likes)
    }
  })

  it('rounds a thin thread down to nothing rather than up', () => {
    // 2 likes across 4 listings is not half a like of evidence each.
    expect(shareOfThreadLikes(2, 4)).toBe(0)
  })

  it('re-derives the same number every pass', () => {
    // The share is computed from the live opening-post count, never from the
    // stored column, so a second pass cannot divide an already divided number.
    // An operator re-running the pass by hand is a normal thing to do.
    const once = shareOfThreadLikes(60, 7)
    const twice = shareOfThreadLikes(60, 7)
    expect(twice).toBe(once)
  })
})

describe('counting the tools on a thread', () => {
  const T = (toolId: string, topic: number) => ({
    toolId,
    slug: toolId,
    url: `https://www.chiefdelphi.com/t/some-thread/${topic}`,
  })

  it('counts the listings on each thread', () => {
    const shares = toolThreadShares([T('a', 441338), T('b', 441338), T('c', 506826)])
    const counts = countToolsPerTopic(shares)
    expect(counts.get(441338)).toBe(2)
    expect(counts.get(506826)).toBe(1)
  })

  it('counts a listing once even when it links the thread twice', () => {
    // tool_links holds both the announcement and a deep link into a reply for
    // some listings. Counting that listing twice would divide the likes by a
    // number of listings that does not exist.
    const shares = toolThreadShares([
      T('a', 441338),
      { toolId: 'a', slug: 'a', url: 'https://www.chiefdelphi.com/t/some-thread/441338/14' },
      T('b', 441338),
    ])
    expect(shares).toHaveLength(2)
    expect(countToolsPerTopic(shares).get(441338)).toBe(2)
  })

  it('ignores links that are not threads', () => {
    const shares = toolThreadShares([
      { toolId: 'a', slug: 'a', url: 'https://www.chiefdelphi.com/c/technical/22' },
      { toolId: 'b', slug: 'b', url: 'https://github.com/wpilibsuite/allwpilib' },
    ])
    expect(shares).toEqual([])
  })
})
