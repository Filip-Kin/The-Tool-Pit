import { getRedis } from '../redis.js'
import { delay } from '../connectors/base.js'

/**
 * Brave Search API client with a HARD monthly query budget.
 *
 * Why the budget lives here and not at Brave: the key's own rate-limit headers
 * report `x-ratelimit-policy: 50;w=1, 0;w=2592000` - 50 queries per second,
 * and a monthly window with a limit of 0, meaning Brave enforces no monthly
 * ceiling on this key. Nothing upstream will stop a runaway sweep, so the cap
 * has to be ours and it has to be checked before every single call.
 *
 * The counter is a Redis key per calendar month, incremented BEFORE the
 * request goes out (so a crash mid-flight over-counts rather than
 * under-counts) and expired well after the month ends so the history is
 * visible for a while.
 *
 * When the budget runs out we do not fail the job: we stop searching, say
 * exactly how many queries were dropped, and let the other discovery angles
 * (sponsor pages, Chief Delphi, manual submissions) carry the pass. A silent
 * truncation would read as "we searched everything" when we did not.
 */

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

/** Conservative default. Raise with BRAVE_MONTHLY_QUERY_CAP once the spend is known. */
const DEFAULT_MONTHLY_CAP = 1800

/**
 * One request per second. The key allows 50/s, but discovery is never urgent
 * and a slow sweep is indistinguishable from a fast one at this cadence.
 */
const MIN_REQUEST_INTERVAL_MS = 1100

let lastRequestAt = 0

function monthKey(now = new Date()): string {
  return `grants:brave:spend:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthlyCap(): number {
  const raw = process.env.BRAVE_MONTHLY_QUERY_CAP
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MONTHLY_CAP
}

export interface BraveResult {
  title: string
  url: string
  description: string
  /** Brave's own age string, e.g. "2 days ago". Useful for freshness sorting. */
  age?: string
}

export interface BraveBudget {
  used: number
  cap: number
  remaining: number
}

/** Current month's spend, for the admin screen and for job stats. */
export async function getBraveBudget(): Promise<BraveBudget> {
  const redis = getRedis()
  const used = parseInt((await redis.get(monthKey())) ?? '0', 10) || 0
  const cap = monthlyCap()
  return { used, cap, remaining: Math.max(0, cap - used) }
}

/** Thrown when the monthly budget is exhausted. Callers stop, they do not retry. */
export class BraveBudgetExhausted extends Error {
  constructor(public readonly budget: BraveBudget) {
    super(`Brave monthly query budget exhausted (${budget.used}/${budget.cap})`)
    this.name = 'BraveBudgetExhausted'
  }
}

/**
 * Run one web search. Spends exactly one query from the budget.
 * `count` costs the same whether it is 1 or 20, so ask for a full page.
 */
export async function braveSearch(
  query: string,
  opts: { count?: number; country?: string; freshness?: string } = {},
): Promise<BraveResult[]> {
  const token = process.env.BRAVE_SEARCH_API_KEY
  if (!token) throw new Error('BRAVE_SEARCH_API_KEY is not set')

  const redis = getRedis()
  const key = monthKey()
  const cap = monthlyCap()

  // Reserve the query first. INCR is atomic, so two workers cannot both see
  // the last slot as free.
  const used = await redis.incr(key)
  if (used === 1) {
    // 70 days: long enough that last month's number is still readable.
    await redis.expire(key, 70 * 24 * 60 * 60)
  }
  if (used > cap) {
    // Hand the slot back so the count reflects real spend, not attempts.
    await redis.decr(key)
    throw new BraveBudgetExhausted({ used: used - 1, cap, remaining: 0 })
  }

  const since = Date.now() - lastRequestAt
  if (since < MIN_REQUEST_INTERVAL_MS) await delay(MIN_REQUEST_INTERVAL_MS - since)
  lastRequestAt = Date.now()

  const url = new URL(ENDPOINT)
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(opts.count ?? 20))
  if (opts.country) url.searchParams.set('country', opts.country)
  if (opts.freshness) url.searchParams.set('freshness', opts.freshness)

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': token,
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Brave search ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> }
  }

  return (data.web?.results ?? [])
    .filter((r): r is { title: string; url: string; description?: string; age?: string } =>
      Boolean(r.url && r.title),
    )
    .map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description ?? '',
      age: r.age,
    }))
}
