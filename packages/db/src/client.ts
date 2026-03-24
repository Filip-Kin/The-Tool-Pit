import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index'

let _client: ReturnType<typeof createClient> | undefined

function createClient() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const conn = postgres(url, {
    // In serverless/edge environments, limit pool size
    max: process.env.NODE_ENV === 'production' ? 10 : 3,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  return drizzle(conn, { schema, logger: process.env.NODE_ENV === 'development' })
}

/**
 * Returns a singleton DB client. Safe to call at module level in Next.js
 * because the module is only loaded when DATABASE_URL is available.
 */
export function getDb() {
  if (!_client) {
    _client = createClient()
  }
  return _client
}

export type Db = ReturnType<typeof getDb>
