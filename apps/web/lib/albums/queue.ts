import { Queue } from 'bullmq'
import { getRedis } from '@/lib/redis'
import type { AlbumEnrichPayload } from '@the-tool-pit/types'

let _queue: Queue<AlbumEnrichPayload> | undefined

export function getAlbumEnrichQueue(): Queue<AlbumEnrichPayload> {
  if (!_queue) {
    _queue = new Queue<AlbumEnrichPayload>('album-enrich', {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 3000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    })
  }
  return _queue
}
