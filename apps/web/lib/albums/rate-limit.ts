import { getRedis } from '@/lib/redis'

/** Max 10 album submissions per hour per IP. */
export async function checkAlbumSubmissionRateLimit(ipHash: string): Promise<boolean> {
  if (!ipHash) return true
  const redis = getRedis()
  const key = `rl:album-submit:${ipHash}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 3600)
  return count <= 10
}
