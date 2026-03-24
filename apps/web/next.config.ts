import type { NextConfig } from 'next'
import { readFileSync } from 'fs'
import { join } from 'path'

// Next.js looks for .env in the app directory (apps/web), not the monorepo root.
// Load the root .env manually so all server-side code has access to env vars.
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
  // In production (Coolify), env vars are injected directly — no .env file needed
}

const nextConfig: NextConfig = {
  transpilePackages: ['@the-tool-pit/db', '@the-tool-pit/types'],
  output: 'standalone',
  images: {
    domains: ['avatars.githubusercontent.com', 'github.com'],
  },
}

export default nextConfig
