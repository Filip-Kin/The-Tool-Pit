import { describe, it, expect } from 'vitest'
import { readRateLimit, isRateLimited } from '../src/connectors/github.js'
import { openingPostLikes, parseChiefDelphiTopicId } from '../src/connectors/discourse.js'

/**
 * The two readings the daily popularity pass depends on, tested away from the
 * network: is GitHub refusing us for the rest of the hour, and how many people
 * liked the post that announced this tool.
 *
 * Both payload shapes below are trimmed from real responses. The Chief Delphi
 * ones are the actual numbers off production threads, because the whole
 * argument for using the opening post rather than the topic is a comparison
 * between those two numbers on those threads.
 */

describe('GitHub rate limit headers', () => {
  it('reads the remaining budget', () => {
    const headers = new Headers({ 'x-ratelimit-remaining': '4321' })
    expect(readRateLimit(headers).remaining).toBe(4321)
  })

  it('reports null rather than zero when the header is absent', () => {
    // Absent and empty are different facts. Zero would stop the pass on a
    // response that never said anything about a budget.
    expect(readRateLimit(new Headers()).remaining).toBeNull()
    expect(readRateLimit(new Headers({ 'x-ratelimit-remaining': '' })).remaining).toBeNull()
  })

  it('reads the primary limit reset as epoch seconds', () => {
    const headers = new Headers({ 'x-ratelimit-reset': '1788307200' })
    expect(readRateLimit(headers).resetAt?.toISOString()).toBe('2026-09-02T00:00:00.000Z')
  })

  it('falls back to Retry-After, which is the only thing a secondary limit sends', () => {
    const headers = new Headers({ 'retry-after': '60' })
    const { resetAt } = readRateLimit(headers)
    expect(resetAt).not.toBeNull()
    expect(resetAt!.getTime()).toBeGreaterThan(Date.now())
  })

  it('treats 403 with a spent budget as a rate limit', () => {
    expect(isRateLimited(403, new Headers({ 'x-ratelimit-remaining': '0' }))).toBe(true)
  })

  it('does NOT treat a plain 403 as a rate limit', () => {
    // GitHub answers a private repo with 403 too. Stopping the whole pass
    // because one listing went private would leave six hundred stale.
    expect(isRateLimited(403, new Headers({ 'x-ratelimit-remaining': '4900' }))).toBe(false)
    expect(isRateLimited(403, new Headers())).toBe(false)
  })

  it('treats 429 as a rate limit with no header needed', () => {
    expect(isRateLimited(429, new Headers())).toBe(true)
  })

  it('leaves 404 and 200 alone', () => {
    expect(isRateLimited(404, new Headers({ 'x-ratelimit-remaining': '0' }))).toBe(false)
    expect(isRateLimited(200, new Headers({ 'x-ratelimit-remaining': '0' }))).toBe(false)
  })
})

describe('Chief Delphi opening-post likes', () => {
  /** chiefdelphi.com/t/advantagescope-2026-new-horizons/505988, trimmed. */
  const ADVANTAGESCOPE = {
    like_count: 159,
    posts_count: 45,
    post_stream: {
      posts: [
        { actions_summary: [{ id: 2, count: 62 }, { id: 6, count: 0 }] },
        { actions_summary: [{ id: 2, count: 11 }] },
        { actions_summary: [{ id: 2, count: 21 }] },
      ],
    },
  }

  /** chiefdelphi.com/t/statbotics-2023-season/423703. 424 posts, 102 GitHub stars. */
  const STATBOTICS = {
    like_count: 2186,
    posts_count: 424,
    post_stream: {
      posts: [
        { actions_summary: [{ id: 2, count: 69 }] },
        { actions_summary: [{ id: 2, count: 40 }] },
      ],
    },
  }

  /** chiefdelphi.com/t/photonvision-reported-latency-jumps/498306. A bug report. */
  const SUPPORT_THREAD = {
    like_count: 5,
    posts_count: 17,
    post_stream: { posts: [{ actions_summary: [{ id: 6, count: 1 }] }] },
  }

  it('takes the opening post, not the thread total', () => {
    expect(openingPostLikes(ADVANTAGESCOPE)).toBe(62)
  })

  it('does not let a long thread outrank a good tool', () => {
    // This is the whole reason the topic's own like_count is unusable.
    // Statbotics scores 21x AdvantageScope on like_count and a third of it on
    // stars, because like_count counts posts and this thread ran to 424.
    expect(STATBOTICS.like_count).toBeGreaterThan(ADVANTAGESCOPE.like_count * 10)
    expect(openingPostLikes(STATBOTICS)).toBeLessThan(openingPostLikes(ADVANTAGESCOPE) * 1.5)
  })

  it('scores a support thread at zero without needing a rule for it', () => {
    // Some tool_links forum entries point at a bug report rather than an
    // announcement, because that is where the crawler met the tool. Nobody
    // likes a question, so the signal excludes them by itself.
    expect(openingPostLikes(SUPPORT_THREAD)).toBe(0)
  })

  it('reads zero from an empty or malformed thread', () => {
    expect(openingPostLikes({})).toBe(0)
    expect(openingPostLikes({ post_stream: { posts: [] } })).toBe(0)
    expect(openingPostLikes({ post_stream: { posts: [{}] } })).toBe(0)
  })
})

describe('Chief Delphi topic ids', () => {
  it('reads the id out of a thread URL', () => {
    expect(parseChiefDelphiTopicId('https://www.chiefdelphi.com/t/choreo-2026/510723')).toBe(510723)
  })

  it('takes the topic id, not the post number', () => {
    // /t/<slug>/<topic>/<post> is what a deep link into a thread looks like.
    expect(parseChiefDelphiTopicId('https://www.chiefdelphi.com/t/choreo-2026/510723/14')).toBe(510723)
  })

  it('returns null for anything that is not a thread', () => {
    expect(parseChiefDelphiTopicId('https://www.chiefdelphi.com/c/technical/22')).toBeNull()
    expect(parseChiefDelphiTopicId('https://www.chiefdelphi.com/u/someone')).toBeNull()
    expect(parseChiefDelphiTopicId('https://github.com/wpilibsuite/allwpilib')).toBeNull()
  })
})
