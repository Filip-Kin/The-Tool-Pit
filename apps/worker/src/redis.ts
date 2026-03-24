import Redis from 'ioredis'

let _redis: Redis | undefined

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL
    if (!url) throw new Error('REDIS_URL is not set')
    _redis = new Redis(url, {
      maxRetriesPerRequest: null, // BullMQ requirement
      enableReadyCheck: false,
    })
    _redis.on('error', (err) => console.error('[redis] error', err.message))
  }
  return _redis
}
