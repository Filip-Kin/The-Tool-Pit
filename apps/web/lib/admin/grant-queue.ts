import { Queue } from 'bullmq'
import { getRedis } from '@/lib/redis'

/**
 * The web app's handle on the grant-extract queue.
 *
 * SHARED NAME WITH THE WORKER. 'grant-extract' is declared in
 * apps/worker/src/queues.ts and consumed in apps/worker/src/index.ts. The web
 * app cannot import from apps/worker, so the name and the payload shape are
 * repeated here and MUST change in both places together. If they drift, a
 * moderator's flag silently produces a job nothing ever runs.
 */
const GRANT_EXTRACT_QUEUE = 'grant-extract'

export interface GrantExtractRequest {
  candidateId: string
  /** Refetch the page, follow the application link, look at other surfaces. */
  deep?: boolean
  /** What the moderator said was wrong, passed to the model on the re-read. */
  reviewNote?: string | null
}

let _queue: Queue<GrantExtractRequest> | undefined

function getExtractQueue(): Queue<GrantExtractRequest> {
  if (!_queue) {
    _queue = new Queue<GrantExtractRequest>(GRANT_EXTRACT_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    })
  }
  return _queue
}

/**
 * Ask for one candidate to be extracted again. Returns whether the job was
 * accepted.
 *
 * A Redis that is down must not lose a moderation decision: the caller has
 * already written the row, so a failure here costs a re-read that can be asked
 * for again, not the flag itself. Logged rather than thrown for that reason.
 */
export async function enqueueGrantExtract(request: GrantExtractRequest): Promise<boolean> {
  try {
    await getExtractQueue().add(GRANT_EXTRACT_QUEUE, request)
    return true
  } catch (err) {
    console.error('[admin/grants] could not queue a re-extraction', err)
    return false
  }
}
