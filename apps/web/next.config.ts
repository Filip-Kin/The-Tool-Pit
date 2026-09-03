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
  // In production (Coolify), env vars are injected directly, no .env file needed
}

const nextConfig: NextConfig = {
  transpilePackages: ['@the-tool-pit/db', '@the-tool-pit/types'],
  serverExternalPackages: ['bullmq'],
  // Cover-image uploads go through a server action; the default 1 MB body cap
  // rejects most photos, so allow room for a full-size cover.
  //
  // This sits deliberately above MAX_UPLOAD_BYTES in lib/images/normalise.ts
  // (25 MB). Next rejects an over-limit body BEFORE the action runs, and the
  // browser then shows "An unexpected response was received from the server"
  // with nothing we can catch. The headroom means the action always gets to
  // run and can return a real "Image is larger than 25 MB." instead.
  //
  // The server downscales and re-encodes every upload now, so the stored row is
  // a few hundred KB whatever arrives here; this limit only bounds the request.
  //
  // middlewareClientMaxBodySize is the same idea for ROUTE HANDLERS, which is
  // where the public field-photo uploads go (app/api/fields/submit and
  // app/api/fields/[id]/edit). Next 15.5 defaults it to 10 MB and TRUNCATES a
  // larger body rather than rejecting it, so req.formData() then throws
  // "Failed to parse body as FormData" and the submitter gets a 500. That is
  // why a two-photo submission from a phone has been failing even though the
  // form offers eight. This sits above MAX_UPLOAD_BATCH_BYTES (50 MB) so the
  // batch check in lib/images/normalise.ts is what refuses an oversize post,
  // with a message that says what to do.
  experimental: {
    serverActions: { bodySizeLimit: '30mb' },
    middlewareClientMaxBodySize: '56mb',
  },
  // Standalone output is required for Docker/Coolify deployment.
  // Disabled locally on Windows because bun's symlink-based module cache
  // causes EPERM errors when Next.js tries to copy traced files.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: 'github.com' },
      // Photo album hosts (cover thumbnails)
      { protocol: 'https', hostname: '**.smugmug.com' },
      { protocol: 'https', hostname: 'live.staticflickr.com' },
      { protocol: 'https', hostname: 'farm*.staticflickr.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: '**.pixieset.com' },
      { protocol: 'https', hostname: 'firstinmichigan.us' },
    ],
  },
}

export default nextConfig
