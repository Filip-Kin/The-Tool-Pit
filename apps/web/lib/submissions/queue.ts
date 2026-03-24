import { Queue } from 'bullmq'
import { getRedis } from '@/lib/redis'
import type { SubmissionJobPayload } from '@the-tool-pit/types'

let _queue: Queue<SubmissionJobPayload> | undefined

export function getSubmissionQueue(): Queue<SubmissionJobPayload> {
  if (!_queue) {
    _queue = new Queue<SubmissionJobPayload>('submission', {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    })
  }
  return _queue
}
