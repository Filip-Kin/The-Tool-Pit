import type { Config } from 'drizzle-kit'
import { readFileSync } from 'fs'
import { join } from 'path'

// drizzle-kit runs with packages/db as cwd (turbo executes scripts in the
// package directory). The root .env is two levels up.
// We use process.cwd() instead of import.meta.url to stay in CommonJS-
// compatible mode and avoid jiti's ESM/require conflicts.
try {
  const raw = readFileSync(join(process.cwd(), '../../.env'), 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch {
  // .env absent in CI/production — env vars must be set externally
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not found. Add it to the repo root .env or set it as an env var.')
}

export default {
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
} satisfies Config
