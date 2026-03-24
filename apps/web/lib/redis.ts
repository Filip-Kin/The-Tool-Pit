import Redis from 'ioredis'

let _redis: Redis | undefined

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL
    if (!url) throw new Error('REDIS_URL is not set')
    _redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
    })
    _redis.on('error', (err) => {
      // Log but don't crash — Redis is used for rate-limiting/caching,
      // not for core data. Fail open where possible.
      console.error('[redis] connection error', err.message)
    })
  }
  return _redis
}
