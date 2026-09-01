import { getRedis } from '@/lib/redis'

/** Max 8 event submissions per hour per IP. Mirrors the fields limit. */
export async function checkEventSubmissionRateLimit(ipHash: string): Promise<boolean> {
  if (!ipHash) return true
  const redis = getRedis()
  const key = `rl:event-submit:${ipHash}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 3600)
  return count <= 8
}
