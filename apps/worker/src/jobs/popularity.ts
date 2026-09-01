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
import { delay } from '../connectors/base.js'

/** Nothing to vary yet. The pass always covers every published listing. */
export type PopularityRefreshPayload = Record<string, never>

export interface PopularityRefreshStats {
  githubConsidered: number
  githubRefreshed: number
  /** 404s. The last known star count is kept, deliberately. */
  githubGone: number
  githubFailed: number
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

export async function processPopularityRefreshJob(): Promise<PopularityRefreshStats> {
  const db = getDb()
  const stats: PopularityRefreshStats = {
    githubConsidered: 0,
    githubRefreshed: 0,
    githubGone: 0,
    githubFailed: 0,
    stoppedEarly: false,
    scoresRewritten: 0,
  }

  // #region GitHub stars

  const githubTargets = await db
    .select({ id: tools.id, slug: tools.slug, url: toolLinks.url })
    .from(tools)
    .innerJoin(toolLinks, eq(toolLinks.toolId, tools.id))
    .where(and(eq(tools.status, 'published'), eq(toolLinks.linkType, 'github')))

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
    .where(eq(tools.status, 'published'))
    .returning({ id: tools.id })
  stats.scoresRewritten = rewritten.length

  // #endregion

  console.log(
    `[popularity] github ${stats.githubRefreshed}/${stats.githubConsidered} refreshed, ` +
      `${stats.githubGone} gone, ${stats.githubFailed} failed; ` +
      `${stats.scoresRewritten} scores rewritten` +
      (stats.stoppedEarly ? ' (STOPPED EARLY on rate limit)' : ''),
  )

  return stats
}
