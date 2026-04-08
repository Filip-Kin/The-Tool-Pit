/**
 * Link-checker job.
 * HEAD-fetches every URL in tool_links and writes isBroken / lastCheckedAt.
 *
 * Sentinel pattern (toolId === '__all__'): fetches all published tools that have
 * links and enqueues individual link-check jobs with staggered delays.
 *
 * Per-tool: HEAD-fetches each link URL (10 s timeout, follow redirects) and
 * marks broken if the response status is a non-auth 4xx or any 5xx, or if the
 * request throws (network error / timeout).
 *
 * Not broken: 401/403 (auth-gated resources are still alive), 3xx (redirects
 * followed automatically), 2xx.
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { getDb, tools, toolLinks } from '@the-tool-pit/db'
import { linkCheckQueue } from '../queues.js'
import type { LinkCheckPayload } from '@the-tool-pit/types'

/** Statuses that indicate a live (not broken) link, even if access is restricted. */
const NOT_BROKEN_STATUSES = new Set([200, 201, 204, 301, 302, 303, 307, 308, 401, 403, 405])

async function isUrlBroken(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'The-Tool-Pit/1.0 (+https://thetoolpit.com)' },
    })
    return !NOT_BROKEN_STATUSES.has(res.status)
  } catch {
    // Network error, timeout, DNS failure → broken
    return true
  } finally {
    clearTimeout(timer)
  }
}

export async function processLinkCheckerJob(payload: LinkCheckPayload): Promise<void> {
  const db = getDb()

  if (payload.toolId === '__all__') {
    // Fetch all distinct tool IDs that have at least one link and are published
    const rows = await db
      .selectDistinct({ toolId: toolLinks.toolId })
      .from(toolLinks)
      .innerJoin(tools, eq(tools.id, toolLinks.toolId))
      .where(eq(tools.status, 'published'))

    console.log(`[link-check] enqueueing ${rows.length} individual link-check jobs`)

    for (let i = 0; i < rows.length; i++) {
      await linkCheckQueue.add(
        'link-check-tool',
        { toolId: rows[i].toolId },
        { delay: i * 100 }, // spread over ~(n * 100ms) to avoid hammering hosts
      )
    }
    return
  }

  // Per-tool: fetch all links, HEAD-check each one
  const links = await db
    .select()
    .from(toolLinks)
    .where(eq(toolLinks.toolId, payload.toolId))

  if (links.length === 0) return

  console.log(`[link-check] checking ${links.length} links for tool ${payload.toolId}`)

  for (const link of links) {
    const broken = await isUrlBroken(link.url)
    await db
      .update(toolLinks)
      .set({ isBroken: broken, lastCheckedAt: new Date() })
      .where(eq(toolLinks.id, link.id))

    if (broken) {
      console.log(`[link-check] broken link detected: ${link.url} (tool ${payload.toolId})`)
    }
  }
}
