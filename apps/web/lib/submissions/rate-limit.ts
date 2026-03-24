import { getRedis } from '@/lib/redis'

/** Max 5 submissions per hour per IP. */
export async function checkSubmissionRateLimit(ipHash: string): Promise<boolean> {
  if (!ipHash) return true
  const redis = getRedis()
  const key = `rl:submit:${ipHash}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 3600)
  return count <= 5
}
