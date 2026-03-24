import { getRedis } from '@/lib/redis'

/**
 * Sliding-window rate limit: max 20 vote toggles per minute per IP.
 * Returns true if the action is allowed.
 */
export async function checkVoteRateLimit(ipHash: string): Promise<boolean> {
  if (!ipHash) return true // can't rate-limit without IP
  const redis = getRedis()
  const key = `rl:vote:${ipHash}`
  const now = Date.now()
  const windowMs = 60_000
  const limit = 20

  const pipeline = redis.pipeline()
  pipeline.zremrangebyscore(key, '-inf', now - windowMs)
  pipeline.zadd(key, now, `${now}`)
  pipeline.zcard(key)
  pipeline.expire(key, 120)

  const results = await pipeline.exec()
  const count = (results?.[2]?.[1] as number) ?? 0
  return count <= limit
}
