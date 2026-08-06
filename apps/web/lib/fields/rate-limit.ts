import { getRedis } from '@/lib/redis'

/** Max 8 field submissions per hour per IP. */
export async function checkFieldSubmissionRateLimit(ipHash: string): Promise<boolean> {
  if (!ipHash) return true
  const redis = getRedis()
  const key = `rl:field-submit:${ipHash}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 3600)
  return count <= 8
}
