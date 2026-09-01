import { getRedis } from '@/lib/redis'

/**
 * The one submission rate limit.
 *
 * There were six of these, one per vertical, and five of them were the same
 * eleven lines: INCR a key, EXPIRE it on the first hit, compare against a
 * number. Only the key prefix and the number ever differed, and both of those
 * are data. A sixth copy is how a vertical ends up with a limit nobody chose,
 * or with an hour that is quietly 3600 in five files and 3599 in one.
 *
 * Voting keeps its own limiter in lib/voting/rate-limit.ts and should. It is a
 * sliding window over a sorted set because twenty votes per MINUTE has to
 * survive a burst landing either side of a fixed boundary. A submission cap of
 * five per hour does not care.
 *
 * FAILS OPEN, on purpose and in two ways. No IP hash means no limit, because a
 * request with no forwarded-for header is far more likely to be a health check
 * or a proxy we misread than an attack. And Redis being down must not stop
 * people submitting: the limiter is spam control, not a correctness guard, and
 * the real wall in front of a script is Turnstile plus the fact that nothing
 * published without a moderator reading it.
 */

/** Which queue is being written to. The value is the Redis key prefix. */
export type SubmissionBucket =
  | 'submit'
  | 'album-submit'
  | 'event-submit'
  | 'field-submit'
  | 'grant-submit'
  | 'robot-code-submit'

/**
 * Submissions allowed per hour per IP, by queue.
 *
 * The numbers are the ones each vertical already had, kept rather than averaged
 * because they were reasoned about separately and the reasons still hold.
 *
 *   - Tools and grants sit at 5. Both are a few lines of typing, so a run of
 *     them is far more likely to be a script than a keen mentor.
 *   - Fields, events and robot code sit at 8. The honest use of those forms is
 *     a team catching up in one sitting: two fields, last season's code, this
 *     season's code and the CAD for both. Cutting that off at five turns a good
 *     contributor away mid-backfill.
 *   - Albums sit at 10, the highest, because one photographer posting a
 *     weekend's events is the normal case rather than the suspicious one.
 */
const HOURLY_LIMIT: Record<SubmissionBucket, number> = {
  'submit': 5,
  'grant-submit': 5,
  'field-submit': 8,
  'event-submit': 8,
  'robot-code-submit': 8,
  'album-submit': 10,
}

const WINDOW_SECONDS = 3600

/** True when this submission is allowed through. */
export async function checkSubmissionRateLimit(
  bucket: SubmissionBucket,
  ipHash: string,
): Promise<boolean> {
  if (!ipHash) return true

  const key = `rl:${bucket}:${ipHash}`
  try {
    const redis = getRedis()
    const count = await redis.incr(key)
    // Only on the first hit, so the hour runs from the first submission rather
    // than sliding forward every time somebody submits again.
    if (count === 1) await redis.expire(key, WINDOW_SECONDS)
    return count <= HOURLY_LIMIT[bucket]
  } catch (err) {
    console.error(`[rate-limit] ${bucket} check failed, allowing: ${(err as Error).message}`)
    return true
  }
}
