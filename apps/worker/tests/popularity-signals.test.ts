import { describe, it, expect } from 'vitest'
import { readRateLimit, isRateLimited } from '../src/connectors/github.js'

/**
 * The reading the daily popularity pass depends on, tested away from the
 * network: is GitHub refusing us for the rest of the hour, or merely saying no
 * to one repo.
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
