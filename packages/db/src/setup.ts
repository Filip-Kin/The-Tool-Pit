/**
 * One-time database setup: enables required PostgreSQL extensions.
 * Run this BEFORE db:push or db:migrate.
 *
 *   cd packages/db && npx tsx src/setup.ts
 */
import { getDb } from './client'
import { sql } from 'drizzle-orm'

async function setup() {
  const db = getDb()

  console.log('Enabling PostgreSQL extensions...')

  // pg_trgm is required for the trigram search index on tool names
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`)
  console.log('  ✓ pg_trgm')

  // uuid-ossp provides uuid_generate_v4() (gen_random_uuid() is built-in,
  // but some older Postgres setups need this for compatibility)
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)
  console.log('  ✓ uuid-ossp')

  console.log('Setup complete. You can now run: npx drizzle-kit push')
  process.exit(0)
}

setup().catch((err) => {
  console.error('Setup failed:', err.message)
  process.exit(1)
})
