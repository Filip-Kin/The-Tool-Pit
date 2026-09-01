import { getRedis } from '@/lib/redis'

/**
 * Max 8 robot code / CAD submissions per hour per IP.
 *
 * Higher than the grants limit (5) and level with fields, because the honest
 * use of this form is a team catching up: last season's code, this season's
 * code, and the CAD for both, in one sitting. Cutting that off at five would
 * turn a good contributor away mid-backfill.
 */
export async function checkRobotCodeSubmissionRateLimit(ipHash: string): Promise<boolean> {
  if (!ipHash) return true
  const redis = getRedis()
  const key = `rl:robot-code-submit:${ipHash}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 3600)
  return count <= 8
}
