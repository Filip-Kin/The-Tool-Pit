/**
 * Web search connector: ask Brave for grant pages we have never seen.
 *
 * The reason this connector exists at all is the per-state sweep. National
 * names (Haas, NASA, DoD STEM) are already on every "how to fund your team"
 * list and a team can find them without us. The money nobody finds is local:
 * a state STEM office, a community foundation, a county education fund. Those
 * only surface if the query names the state, so the plan is national queries
 * plus one query per US state and DC.
 *
 * That full plan is far more queries than one run should spend, so runs take a
 * rotating slice and the cursor lives in Redis. Every run reports exactly how
 * many planned queries it did not run, because a truncated sweep that reports
 * success reads as "we searched everywhere" when we searched a fraction.
 *
 * The Brave budget is a hard stop, not a failure: if it runs out mid-sweep we
 * return what we have. The other three angles still carry the pass.
 */
import { eq } from 'drizzle-orm'
import { getDb, grantSources } from '@the-tool-pit/db'
import { getRedis } from '../../redis.js'
import { braveSearch, getBraveBudget, BraveBudgetExhausted } from '../brave.js'
import { canonicalGrantUrl, isNonFunderHost } from './shared.js'
import type {
  GrantConnector,
  GrantConnectorContext,
  GrantConnectorResult,
  GrantCandidateInput,
} from './types.js'

/** Redis cursor so consecutive runs cover different states rather than the same ones. */
const CURSOR_KEY = 'grants:websearch:cursor'

/** Default queries per run. One Brave query is one budget unit, see ../brave.ts. */
const DEFAULT_MAX_QUERIES = 24

/** How much of a run is spent on national queries before the state sweep. */
const NATIONAL_SHARE = 4

/**
 * National and programme-wide queries. Deliberately phrased the way a funder
 * writes its own page ("application", "eligibility", "deadline") rather than
 * the way a team asks ("how do I get money"), because the second phrasing
 * returns forum threads and blog posts.
 */
const NATIONAL_QUERIES = [
  'FIRST Robotics Competition team grant application eligibility',
  'FTC robotics team grant application deadline',
  'high school robotics team grant application form',
  'STEM education grant youth robotics team apply',
  'foundation grant robotics team funding application eligibility',
  'corporate giving STEM robotics team grant apply',
  'community foundation youth STEM grant application robotics',
  'rookie robotics team startup grant application',
  'FIRST LEGO League team grant application',
  'robotics team travel grant championship application',
]

/**
 * US states and DC. The state sweep is the whole point of this connector, so
 * the list is complete rather than a "top states" shortlist. Coverage that
 * stops at the big states is exactly the kind of silent cap we do not ship.
 */
const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island',
  'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
]

/** Two angles per state: the state's own STEM money, and local private money. */
const STATE_TEMPLATES = [
  (state: string) => `${state} STEM education grant robotics team application`,
  (state: string) => `${state} community foundation grant youth robotics team apply`,
]

/**
 * A result with none of these words anywhere is a news story, a team page or a
 * sponsor logo wall. Cheap deterministic filter, run before anything spends a
 * model call downstream.
 */
const MONEY_WORDS = ['grant', 'fund', 'funding', 'award', 'scholarship', 'sponsorship', 'foundation']

function buildStateQueries(): string[] {
  const queries: string[] = []
  for (const template of STATE_TEMPLATES) {
    for (const state of US_STATES) queries.push(template(state))
  }
  return queries
}

/** Take `count` items starting at `offset`, wrapping around the pool. */
function rotate<T>(pool: T[], offset: number, count: number): T[] {
  if (pool.length === 0 || count <= 0) return []
  const take = Math.min(count, pool.length)
  const start = ((offset % pool.length) + pool.length) % pool.length
  const out: T[] = []
  for (let i = 0; i < take; i++) out.push(pool[(start + i) % pool.length])
  return out
}

export class GrantWebSearchConnector implements GrantConnector {
  name = 'grant_web_search'

  async run(ctx: GrantConnectorContext): Promise<GrantConnectorResult> {
    const candidates: GrantCandidateInput[] = []
    const errors: string[] = []
    const limits: string[] = []
    const touchedSourceIds: string[] = []
    let skipped = 0

    // An optional grant_sources row of kind 'web_search' can pin the run: its
    // target replaces the whole plan with one query, and its config can widen
    // or narrow the per-run cap.
    let pinnedQuery: string | undefined
    let maxQueries = parseInt(process.env.GRANT_WEB_SEARCH_MAX_QUERIES ?? '', 10) || DEFAULT_MAX_QUERIES

    if (ctx.sourceId) {
      const db = getDb()
      const [source] = await db
        .select()
        .from(grantSources)
        .where(eq(grantSources.id, ctx.sourceId))
        .limit(1)
      if (source) {
        touchedSourceIds.push(source.id)
        const config = (source.config ?? {}) as { maxQueriesPerRun?: number }
        if (typeof config.maxQueriesPerRun === 'number' && config.maxQueriesPerRun > 0) {
          maxQueries = config.maxQueriesPerRun
        }
        if (source.target.trim().length > 0) pinnedQuery = source.target.trim()
      }
    }

    const stateQueries = buildStateQueries()
    const totalPlan = NATIONAL_QUERIES.length + stateQueries.length

    // The cursor advances by however many state queries we consume, so the
    // sweep walks the whole state list over several runs instead of hammering
    // the alphabet's first few states forever.
    const redis = getRedis()
    const cursor = parseInt((await redis.get(CURSOR_KEY)) ?? '0', 10) || 0

    let plan: string[]
    if (pinnedQuery) {
      plan = [pinnedQuery]
      limits.push(`pinned to a single query from grant_sources, ${totalPlan} rotating queries not run`)
    } else {
      const nationalCount = Math.min(NATIONAL_SHARE, maxQueries)
      const national = rotate(NATIONAL_QUERIES, cursor, nationalCount)
      const states = rotate(stateQueries, cursor, Math.max(0, maxQueries - national.length))
      plan = [...national, ...states]
      // By states.length, NOT plan.length. The cursor's job is to walk the
      // state list, and the national queries share it only because they wrap
      // anyway. Advancing by the whole plan overshot by the national count on
      // every run, so a handful of states were skipped each pass and a given
      // state could go many runs unseen while the limits line below claimed
      // they would be picked up next time.
      await redis.set(CURSOR_KEY, String(cursor + states.length))
      if (plan.length < totalPlan) {
        limits.push(
          `per-run cap: ran ${plan.length} of ${totalPlan} planned queries, cursor at ${cursor}, remaining queries run on later passes`,
        )
      }
    }

    const budgetBefore = await getBraveBudget().catch(() => null)
    if (budgetBefore) {
      console.log(`[grant-web-search] Brave budget ${budgetBefore.used}/${budgetBefore.cap} before run`)
    }

    const seen = new Set<string>()
    let ran = 0
    let budgetStopped = false

    for (const query of plan) {
      try {
        const results = await braveSearch(query, { count: 20, country: 'US' })
        ran++

        for (const result of results) {
          const canonicalUrl = canonicalGrantUrl(result.url)
          if (!canonicalUrl) {
            skipped++
            continue
          }
          if (isNonFunderHost(canonicalUrl)) {
            skipped++
            continue
          }
          if (seen.has(canonicalUrl)) {
            skipped++
            continue
          }

          const haystack = `${result.title} ${result.description} ${canonicalUrl}`.toLowerCase()
          if (!MONEY_WORDS.some((w) => haystack.includes(w))) {
            skipped++
            continue
          }

          seen.add(canonicalUrl)
          candidates.push({
            // A search result page is not a page a human can read later, so the
            // query itself is the provenance and the result URL is both source
            // and canonical.
            sourceUrl: result.url,
            canonicalUrl,
            title: result.title,
            description: result.description || undefined,
            discoveredVia: `web_search:${query}`,
            sourceId: ctx.sourceId,
          })
        }
      } catch (err) {
        if (err instanceof BraveBudgetExhausted) {
          // Hard stop, never a job failure. Say exactly what was dropped.
          budgetStopped = true
          const dropped = plan.length - ran
          limits.push(
            `Brave monthly budget exhausted at ${err.budget.used}/${err.budget.cap} after ${ran} queries, ${dropped} planned queries skipped this run`,
          )
          console.warn(`[grant-web-search] budget exhausted, ${dropped} queries skipped`)
          break
        }
        errors.push(`[grant-web-search] query "${query}" failed: ${String(err)}`)
      }
    }

    // Rewind the cursor to the queries we actually ran, so a budget stop does
    // not silently skip the states we never got to.
    if (budgetStopped && !pinnedQuery) {
      await redis.set(CURSOR_KEY, String(cursor + ran))
    }

    console.log(
      `[grant-web-search] ${ran}/${plan.length} queries ran, ${candidates.length} candidates, ${skipped} results dropped`,
    )
    return { candidates, skipped, errors, limits, touchedSourceIds }
  }
}
