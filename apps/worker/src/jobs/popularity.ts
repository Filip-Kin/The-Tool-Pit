/**
 * Daily popularity refresh.
 *
 * Popular ranks on tools.popularity_score, and until this job existed nothing
 * kept that number true. Stars were written once at publish time and then only
 * moved if a crawl happened to re-publish that exact listing, so the catalogue
 * was accurate by luck: WPILib sat at 1300 against a live 1301, and 173
 * listings held a GitHub link and a zero.
 *
 * ONE SWEEP JOB, NOT A FAN-OUT. The freshness pass queues a job per tool, which
 * is fine when each job only has to answer for itself. This one cannot: a rate
 * limit is a fact about the whole pass, and six hundred independent jobs each
 * discovering the same 403 is exactly the hammering that gets a token
 * restricted. The budget has to be held in one place, so the loop is here.
 *
 * It also owns popularity_score outright. Three writers used to share it and
 * they disagreed: apps/web/lib/voting/vote.ts wrote votes + stars + likes, and
 * the freshness pass wrote stars + likes, so every upvote was erased within a
 * day of being cast. The recompute at the end of this pass is one statement
 * over every published row, which repairs that drift wherever it came from.
 */
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { tools, toolLinks } from '@the-tool-pit/db'
import { fetchGitHubRepoOutcome } from '../connectors/github.js'
import { fetchChiefDelphiTopic, parseChiefDelphiTopicId } from '../connectors/discourse.js'
import { delay } from '../connectors/base.js'

export interface PopularityRefreshPayload {
  /**
   * Refresh ONE listing rather than sweeping every published row.
   *
   * Set when somebody has just added or changed a GitHub link. Waiting until
   * 07:20 tomorrow to find out a tool has 400 stars means the person who added
   * the link sees a zero and reasonably concludes it did not work. One listing
   * is two requests, so there is no reason to make them wait.
   */
  toolId?: string

  /**
   * Skip the Chief Delphi half. The forum moves far slower than GitHub and it
   * is somebody else's server, so an operator re-running the pass by hand to
   * pick up stars should not make 165 more requests to it.
   */
  skipChiefDelphi?: boolean
}

export interface PopularityRefreshStats {
  githubConsidered: number
  githubRefreshed: number
  /** 404s. The last known star count is kept, deliberately. */
  githubGone: number
  githubFailed: number
  chiefDelphiConsidered: number
  chiefDelphiRefreshed: number
  chiefDelphiFailed: number
  /** True when a rate limit cut the pass short. Tomorrow's pass finishes it. */
  stoppedEarly: boolean
  scoresRewritten: number
}

/**
 * Pause between GitHub calls.
 *
 * 5000 requests an hour is 1.4 a second, and the corpus is about 620 repos, so
 * a pass fits inside the budget several times over even at zero delay. The
 * delay is here for the case this file will actually meet: a catalogue that has
 * grown, or a second job sweeping at the same time. 250ms caps the pass at four
 * requests a second, which no reasonable growth curve turns into a problem.
 */
const GITHUB_DELAY_MS = 250

/**
 * Stop this far above empty rather than at zero.
 *
 * Enrichment and the freshness pass share the same token, and a sweep that
 * drains the budget to nothing takes them down with it until the hour rolls
 * over. Leaving a hundred requests means an owner submitting a tool still gets
 * their repo read.
 */
const RATE_LIMIT_FLOOR = 100

/** One published listing and the Chief Delphi thread it points at. */
export interface ToolThreadShare {
  toolId: string
  slug: string
  topicId: number
}

/**
 * Thread links turned into one row per listing per thread.
 *
 * Deduplicated on the pair. A listing can carry the same thread twice in
 * tool_links, once as the announcement and once as a deep link into a reply,
 * and counting that listing twice would divide the likes by a number of
 * listings that does not exist.
 */
export function toolThreadShares(links: Array<{ toolId: string; slug?: string; url: string }>): ToolThreadShare[] {
  const seen = new Set<string>()
  const out: ToolThreadShare[] = []
  for (const link of links) {
    const topicId = parseChiefDelphiTopicId(link.url)
    if (topicId === null) continue // a category or user page, not a thread
    const key = `${link.toolId}:${topicId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ toolId: link.toolId, slug: link.slug ?? link.toolId, topicId })
  }
  return out
}

/** How many published listings point at each thread. */
export function countToolsPerTopic(shares: ToolThreadShare[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const share of shares) counts.set(share.topicId, (counts.get(share.topicId) ?? 0) + 1)
  return counts
}

/**
 * One listing's share of the likes on a thread it does not have to itself.
 *
 * A thread that announces several tools was liked for what the thread
 * announced, not once for each tool in it. Crediting the full count to every
 * listing was measured in production and it is not a rounding error: the Open
 * Alliance 2024 directory thread has 60 likes and seven listings were each
 * carrying all 60, the YAMS announcement has 60 across four, PurpleLib 13
 * across four. Eleven listings sat above where they belong because of it, and
 * chief_delphi_likes feeds popularity_score, which orders Popular and carries
 * 0.35 of the search rank.
 *
 * FLOOR, not round. The listings that share a thread must not between them be
 * credited with more approval than the thread actually got, and rounding up
 * does exactly that: 60 across seven rounds to 9 each, which is 63. Floor gives
 * 8 each and leaves the remainder uncredited, which is the honest direction to
 * lose a like in.
 *
 * A thread with one listing is `share = likes`, unchanged. In production 165
 * published listings carry a thread across 102 distinct threads, and 37 of
 * those threads are shared by 100 listings between them, so the undivided case
 * is still 65 listings.
 *
 * Idempotent by construction. The share is computed from the live opening-post
 * count every time, never from the stored column, so running the pass twice
 * writes the same number twice instead of dividing again.
 */
export function shareOfThreadLikes(openingPostLikes: number, sharers: number): number {
  if (sharers <= 1) return openingPostLikes
  return Math.floor(openingPostLikes / sharers)
}

export async function processPopularityRefreshJob(
  payload: PopularityRefreshPayload = {},
): Promise<PopularityRefreshStats> {
  const db = getDb()
  const stats: PopularityRefreshStats = {
    githubConsidered: 0,
    githubRefreshed: 0,
    githubGone: 0,
    githubFailed: 0,
    chiefDelphiConsidered: 0,
    chiefDelphiRefreshed: 0,
    chiefDelphiFailed: 0,
    stoppedEarly: false,
    scoresRewritten: 0,
  }

  // #region GitHub stars

  const onlyTool = payload.toolId ?? null

  const githubTargets = await db
    .select({ id: tools.id, slug: tools.slug, url: toolLinks.url })
    .from(tools)
    .innerJoin(toolLinks, eq(toolLinks.toolId, tools.id))
    .where(
      and(
        eq(tools.status, 'published'),
        eq(toolLinks.linkType, 'github'),
        ...(onlyTool ? [eq(tools.id, onlyTool)] : []),
      ),
    )

  stats.githubConsidered = githubTargets.length

  for (const target of githubTargets) {
    const outcome = await fetchGitHubRepoOutcome(target.url)

    if (outcome.kind === 'rate-limited') {
      // Give up on the whole pass rather than walking into the same wall six
      // hundred more times. The scores already written stand, and the next
      // daily run starts from the top with a full budget.
      const until = outcome.resetAt ? ` until ${outcome.resetAt.toISOString()}` : ''
      console.warn(`[popularity] GitHub rate limited${until}, stopping after ${stats.githubRefreshed} refreshed`)
      stats.stoppedEarly = true
      break
    }

    if (outcome.kind === 'gone') {
      // Repo deleted, renamed or gone private. Leave the stars and
      // starsCheckedAt exactly as they were: writing a zero here would drop the
      // listing out of Popular on the strength of a redirect somebody forgot to
      // set up. Filip suppressed several of these by hand today, so it happens.
      stats.githubGone++
      console.warn(`[popularity] ${target.slug}: repo gone (404), keeping last known stars`)
      await delay(GITHUB_DELAY_MS)
      continue
    }

    if (outcome.kind === 'error') {
      stats.githubFailed++
      console.error(`[popularity] ${target.slug}: ${outcome.message}`)
      await delay(GITHUB_DELAY_MS)
      continue
    }

    await db
      .update(tools)
      .set({ githubStars: outcome.repo.stars, starsCheckedAt: new Date(), updatedAt: new Date() })
      .where(eq(tools.id, target.id))
    stats.githubRefreshed++

    if (outcome.rateLimitRemaining !== null && outcome.rateLimitRemaining <= RATE_LIMIT_FLOOR) {
      console.warn(
        `[popularity] GitHub budget down to ${outcome.rateLimitRemaining}, stopping after ${stats.githubRefreshed} refreshed`,
      )
      stats.stoppedEarly = true
      break
    }

    await delay(GITHUB_DELAY_MS)
  }

  // #endregion

  // #region Chief Delphi likes
  //
  // Half the popularity formula had never done anything: chief_delphi_likes was
  // read by publish.ts and by the ranking, and was zero on all 1094 published
  // listings because nothing ever wrote it.
  //
  // It is worth having, and the reason is the 99 listings that carry a Chief
  // Delphi thread and no GitHub stars at all. Those score zero today and are
  // invisible, and a forum thread is the only popularity evidence that exists
  // for a calculator or a hosted web app with no repo.
  //
  // Left at parity with a star, which is what the existing formula already
  // assumed. On the fifteen listings sampled that carry both, a star count runs
  // roughly one to nine times the like count with a median near three, so a
  // weight of about 3 would put the two on equal footing. That is a tuning
  // decision on fifteen points and it is not made here: parity is the
  // conservative reading, and the ratio is written down so it can be revisited
  // against the full corpus once this job has actually populated the column.
  //
  // The count is DIVIDED between the listings that share a thread. One thread
  // often announces several tools, and giving each of them the whole count was
  // inventing approval that nobody gave. See shareOfThreadLikes.

  if (!payload.skipChiefDelphi) {
    // Every published listing with a Chief Delphi thread, and deliberately NOT
    // narrowed by onlyTool. How many listings share a thread is a fact about
    // the thread, so a single-listing refresh has to see all of them or it
    // would write the undivided count back.
    const cdLinks = await db
      .select({ id: tools.id, slug: tools.slug, url: toolLinks.url })
      .from(tools)
      .innerJoin(toolLinks, eq(toolLinks.toolId, tools.id))
      .where(and(eq(tools.status, 'published'), sql`${toolLinks.url} like '%chiefdelphi.com/t/%'`))

    const allShares = toolThreadShares(cdLinks.map((row) => ({ toolId: row.id, url: row.url })))
    const sharerCounts = countToolsPerTopic(allShares)

    const targets = onlyTool ? allShares.filter((s) => s.toolId === onlyTool) : allShares
    stats.chiefDelphiConsidered = targets.length

    // Grouped by thread, because seven listings used to mean seven requests for
    // the same thread. One read answers for all of them.
    const byTopic = new Map<number, ToolThreadShare[]>()
    for (const share of targets) {
      const list = byTopic.get(share.topicId) ?? []
      list.push(share)
      byTopic.set(share.topicId, list)
    }

    for (const [topicId, sharing] of byTopic) {
      // The Discourse client paces itself, so there is no delay call here.
      const detail = await fetchChiefDelphiTopic(topicId)
      if (!detail) {
        stats.chiefDelphiFailed += sharing.length
        console.warn(
          `[popularity] chief delphi topic ${topicId} did not answer, leaving ${sharing.map((s) => s.slug).join(', ')}`,
        )
        continue
      }

      const sharers = sharerCounts.get(topicId) ?? 1
      const share = shareOfThreadLikes(detail.openingPostLikes, sharers)
      if (sharers > 1) {
        console.log(
          `[popularity] topic ${topicId}: ${detail.openingPostLikes} likes split ${sharers} ways, ${share} each`,
        )
      }

      for (const target of sharing) {
        await db
          .update(tools)
          .set({ chiefDelphiLikes: share, updatedAt: new Date() })
          .where(eq(tools.id, target.toolId))
        stats.chiefDelphiRefreshed++
      }
    }
  }

  // #endregion

  // #region recompute
  //
  // One statement over every published row, not one per tool we touched. A
  // listing whose repo 404'd still needs its votes counted, and a listing the
  // rate limit cut us off before reaching still needs to hold a score that
  // agrees with its own columns. This is the only place the formula is spelled
  // out for a bulk refresh, and vote.ts spells out the same sum for a single
  // row when somebody clicks.

  const rewritten = await db
    .update(tools)
    .set({
      popularityScore: sql`${tools.githubStars} + ${tools.chiefDelphiLikes} + coalesce((
        select count(*) from tool_votes tv where tv.tool_id = ${tools.id}
      ), 0)`,
    })
    .where(and(eq(tools.status, 'published'), ...(onlyTool ? [eq(tools.id, onlyTool)] : [])))
    .returning({ id: tools.id })
  stats.scoresRewritten = rewritten.length

  // #endregion

  console.log(
    `[popularity] github ${stats.githubRefreshed}/${stats.githubConsidered} refreshed, ` +
      `${stats.githubGone} gone, ${stats.githubFailed} failed; ` +
      `chief delphi ${stats.chiefDelphiRefreshed}/${stats.chiefDelphiConsidered} refreshed, ` +
      `${stats.chiefDelphiFailed} failed; ${stats.scoresRewritten} scores rewritten` +
      (stats.stoppedEarly ? ' (STOPPED EARLY on rate limit)' : ''),
  )

  return stats
}
