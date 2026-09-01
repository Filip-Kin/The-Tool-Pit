/**
 * Freshness check job.
 * Re-fetches GitHub metadata for a tool and updates its internal freshness state.
 * The freshness state is then collapsed to Current/Stale/Abandoned on the frontend.
 */
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { tools, toolLinks, toolUpdates } from '@the-tool-pit/db'
import { fetchGitHubRepo } from '../connectors/github.js'
import { differenceInDays } from 'date-fns'
import type { FreshnessCheckPayload } from '@the-tool-pit/types'

type InternalFreshnessState =
  | 'active'
  | 'stale'
  | 'inactive'
  | 'evergreen'
  | 'seasonal'
  | 'archived'
  | 'unknown'

function computeFreshnessState(
  lastActivityAt: Date | null,
  archived: boolean,
): InternalFreshnessState {
  if (archived) return 'archived'
  if (!lastActivityAt) return 'unknown'

  // FRC runs on a season, not a calendar. Build season is January to April, so
  // in September a tool last touched 8 months ago was last touched IN SEASON
  // and is perfectly current. The old 90-day bar marked almost everything
  // stale for the whole offseason, which made the badge meaningless.
  // A year without a commit is the first point worth flagging, and two years
  // means it missed a whole season.
  const daysSince = differenceInDays(new Date(), lastActivityAt)
  if (daysSince <= 365) return 'active'
  if (daysSince <= 730) return 'stale'
  return 'inactive'
}

export async function processFreshnessJob(payload: FreshnessCheckPayload): Promise<void> {
  const db = getDb()

  // Special sentinel: trigger individual freshness checks for all published tools
  if (payload.toolId === '__all__') {
    const allTools = await db
      .select({ id: tools.id })
      .from(tools)
      .where(eq(tools.status, 'published'))

    const { freshnessQueue } = await import('../queues.js')
    for (const tool of allTools) {
      await freshnessQueue.add(
        'check-freshness',
        { toolId: tool.id },
        // Spread checks over 60 seconds to avoid hammering GitHub API
        { delay: Math.floor(Math.random() * 60_000) },
      )
    }
    console.log(`[freshness] queued ${allTools.length} tools for freshness checks`)
    return
  }

  const [tool] = await db
    .select()
    .from(tools)
    .where(eq(tools.id, payload.toolId))
    .limit(1)

  if (!tool) return

  // Look up GitHub link
  const [githubLink] = await db
    .select({ url: toolLinks.url })
    .from(toolLinks)
    .where(
      sql`${toolLinks.toolId} = ${tool.id}::uuid and ${toolLinks.linkType} = 'github'`,
    )
    .limit(1)

  let lastActivityAt: Date | null = tool.lastActivityAt
  let archived = false

  if (githubLink) {
    const repoInfo = await fetchGitHubRepo(githubLink.url)
    if (repoInfo) {
      archived = repoInfo.archived

      if (repoInfo.pushedAt) {
        const pushDate = new Date(repoInfo.pushedAt)
        lastActivityAt = pushDate

        await db.insert(toolUpdates).values({
          toolId: tool.id,
          signalType: 'github_push',
          signalAt: pushDate,
          rawData: { stars: repoInfo.stars, pushedAt: repoInfo.pushedAt, archived: repoInfo.archived },
        })
      }
    }
  }

  const newState = computeFreshnessState(lastActivityAt, archived)

  await db
    .update(tools)
    .set({
      freshnessState: newState,
      lastActivityAt: lastActivityAt ?? tool.lastActivityAt,
      updatedAt: new Date(),
    })
    .where(eq(tools.id, tool.id))

  console.log(`[freshness] ${tool.slug}: ${tool.freshnessState} → ${newState}`)
}
