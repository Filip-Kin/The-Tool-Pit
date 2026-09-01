import { getRedis } from '@/lib/redis'

/**
 * Max 5 grant submissions per hour per IP.
 *
 * Lower than the fields limit (8) because a grant submission is a few lines of
 * typing, so a run of them is far more likely to be a script than a keen mentor
 * adding their team's fields.
 */
export async function checkGrantSubmissionRateLimit(ipHash: string): Promise<boolean> {
  if (!ipHash) return true
  const redis = getRedis()
  const key = `rl:grant-submit:${ipHash}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 3600)
  return count <= 5
}
