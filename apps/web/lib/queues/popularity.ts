import { Queue } from 'bullmq'
import { getRedis } from '@/lib/redis'

/**
 * Ask the worker to re-read one listing's popularity signals now.
 *
 * The sweep runs at 07:20. Waiting for it means somebody who has just pasted a
 * GitHub link or a Chief Delphi thread sees a zero next to their listing and
 * reasonably concludes the link did not take. One listing is two requests, so
 * there is no reason to make them wait.
 *
 * Both halves run for that listing, so the same call covers a repo and a forum
 * thread and the caller does not have to know which signal changed.
 *
 * Never throws. Saving the link is the thing the person asked for; a queue that
 * is briefly unreachable must not turn that into an error, and the daily sweep
 * picks the listing up regardless.
 */
export async function refreshListingPopularity(toolId: string): Promise<void> {
  try {
    const queue = new Queue('popularity', {
      connection: getRedis(),
      defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 200 } },
    })
    await queue.add('popularity-refresh', { toolId })
  } catch (err) {
    console.warn(`[popularity] could not queue a refresh for ${toolId}:`, err)
  }
}

/** The link types that carry a popularity signal worth re-reading. */
export function linkChangeNeedsPopularityRefresh(changedTypes: readonly string[]): boolean {
  // 'forum' is where a Chief Delphi thread lands. Both are checked because a
  // listing can gain either one on its own.
  return changedTypes.includes('github') || changedTypes.includes('forum')
}
