/**
 * Grant DISCOVER job: run one connector, dedupe what it found, file the rest
 * as candidates for a human.
 *
 * The hard rule of this vertical lives in this file. Nothing here writes to
 * the `grants` table, ever. Not a new row, not a deadline, not a "we are sure
 * enough" shortcut. Discovery produces `grant_candidates` with status
 * 'pending' and a person decides. The tools vertical auto-published its crawl
 * output and filled up with forum threads and bot walls; a grants directory
 * that does the same thing publishes a wrong deadline, and a wrong deadline is
 * worse than no deadline.
 *
 * Four connectors feed this, because no single angle finds everything:
 *   seed          - curated funder pages a human already chose.
 *   web_search    - Brave, national plus a rotating per-US-state sweep.
 *   team_sponsors - who teams already thank, counted across team sites.
 *   chief_delphi  - outbound links from funding threads, as leads only.
 *
 * Every bound on coverage that any of them hit (a per-run cap, an exhausted
 * Brave budget, a source not due yet) is carried out on the connector's
 * `limits` and written onto the crawl job, so a partial sweep is visible in
 * the admin rather than reading as a complete one.
 */
import { eq, inArray, isNotNull } from 'drizzle-orm'
import {
  getDb,
  grantCandidates,
  grantCrawlJobs,
  grantSources,
  grants,
  type GrantCrawlStats,
  type RawGrantMetadata,
} from '@the-tool-pit/db'
import { GrantSeedConnector } from './connectors/seed.js'
import { GrantWebSearchConnector } from './connectors/web-search.js'
import { GrantTeamSponsorsConnector } from './connectors/team-sponsors.js'
import { GrantChiefDelphiConnector } from './connectors/chief-delphi.js'
import { GrantAggregatorConnector } from './connectors/aggregator.js'
import { canonicalGrantUrl } from './connectors/shared.js'
import type { GrantConnector } from './connectors/types.js'

/**
 * Payload for the grant-discover queue. Kept here rather than in
 * @the-tool-pit/types so this vertical can land without touching the shared
 * package, the same call ./enrich.ts made for GrantEnrichPayload.
 */
export interface GrantDiscoverPayload {
  /** A key of GRANT_DISCOVER_CONNECTORS, or the bare grant_sources.kind. */
  connector: string
  /** Set when one grant_sources row was requeued by hand from the admin. */
  sourceId?: string
}

/**
 * Connector registry. Both the connector's own name (`grant_seed`) and the
 * matching GRANT_SOURCE_KINDS value (`seed`) resolve, because the admin
 * requeues a source row by its `kind` while the scheduler names the connector.
 */
export const GRANT_DISCOVER_CONNECTORS: Record<string, () => GrantConnector> = {
  grant_seed: () => new GrantSeedConnector(),
  seed: () => new GrantSeedConnector(),
  grant_web_search: () => new GrantWebSearchConnector(),
  web_search: () => new GrantWebSearchConnector(),
  grant_team_sponsors: () => new GrantTeamSponsorsConnector(),
  team_sponsors: () => new GrantTeamSponsorsConnector(),
  grant_chief_delphi: () => new GrantChiefDelphiConnector(),
  chief_delphi: () => new GrantChiefDelphiConnector(),
  grant_aggregator: () => new GrantAggregatorConnector(),
  aggregator: () => new GrantAggregatorConnector(),
}

/**
 * What we persist onto grantCrawlJobs.stats. GrantCrawlStats is the shared
 * shape; `errors` and `limits` are added here because a run that found nothing
 * and a run that was cut off by a budget look identical without them, and
 * "no silent caps" is the whole point. If GrantCrawlStats ever grows these
 * fields, delete the cast at the write site below.
 */
export interface GrantDiscoverStats extends GrantCrawlStats {
  connector: string
  errors: string[]
  limits: string[]
}

export interface GrantDiscoverOutcome {
  jobId: string
  connector: string
  /** grant_candidates ids inserted by this run, for the caller to enqueue enrichment. */
  insertedCandidateIds: string[]
  stats: GrantDiscoverStats
}

/**
 * Canonical URLs already spoken for, so the same funder page is not queued for
 * review twice.
 *
 * Candidates are checked with an IN list against the run's own URLs, which
 * stays cheap as the table grows. Grants cannot be: `grants.infoUrl` is stored
 * as a human typed or approved it, not canonicalised, so the only correct
 * comparison is to canonicalise every grant URL here. The grants table is a
 * curated directory in the hundreds, not a crawl dump, so reading it whole is
 * fine, and it is worth the read because re-listing a grant an admin already
 * approved is the most annoying possible duplicate.
 *
 * Archived grants count too. GRANT_STATUSES documents 'archived' as "the
 * programme has ended for good, kept so a dead grant does not get rediscovered
 * and re-listed every crawl", so filtering to published only would defeat it.
 */
async function loadKnownUrls(runUrls: string[]): Promise<Set<string>> {
  const db = getDb()
  const known = new Set<string>()

  if (runUrls.length > 0) {
    // Chunked because Postgres parameter limits bite well before a crawl does.
    for (let i = 0; i < runUrls.length; i += 500) {
      const chunk = runUrls.slice(i, i + 500)
      const rows = await db
        .select({ canonicalUrl: grantCandidates.canonicalUrl })
        .from(grantCandidates)
        .where(inArray(grantCandidates.canonicalUrl, chunk))
      for (const row of rows) if (row.canonicalUrl) known.add(row.canonicalUrl)
    }
  }

  const grantRows = await db
    .select({ infoUrl: grants.infoUrl, applicationUrl: grants.applicationUrl })
    .from(grants)
    .where(isNotNull(grants.infoUrl))

  for (const row of grantRows) {
    for (const raw of [row.infoUrl, row.applicationUrl]) {
      if (!raw) continue
      const canonical = canonicalGrantUrl(raw)
      if (canonical) known.add(canonical)
    }
  }

  return known
}

/**
 * Run one discovery connector end to end. Returns the job outcome so the
 * caller can enqueue enrichment for the new candidates; it does not enqueue
 * anything itself, because queue wiring lives in ../queues.ts.
 */
export async function processGrantDiscoverJob(
  payload: GrantDiscoverPayload,
): Promise<GrantDiscoverOutcome> {
  const db = getDb()
  const { connector: connectorName, sourceId } = payload

  const factory = GRANT_DISCOVER_CONNECTORS[connectorName]
  if (!factory) {
    // Thrown before the job row is written: an unknown connector is a wiring
    // mistake, not a crawl that failed, and a failed row would suggest the
    // source is broken.
    throw new Error(`Unknown grant discover connector: ${connectorName}`)
  }

  const connector = factory()

  const [jobRecord] = await db
    .insert(grantCrawlJobs)
    .values({
      sourceId: sourceId ?? null,
      connector: connector.name,
      status: 'running',
      startedAt: new Date(),
    })
    .returning({ id: grantCrawlJobs.id })

  const jobId = jobRecord.id
  const insertedCandidateIds: string[] = []

  try {
    const result = await connector.run({ sourceId })

    // #region dedupe

    // Within the run first. Four angles regularly land on the same funder, and
    // that is a good sign, not three extra review chores.
    const byUrl = new Map<string, (typeof result.candidates)[number]>()
    let duplicateInRun = 0
    for (const candidate of result.candidates) {
      const canonical = canonicalGrantUrl(candidate.canonicalUrl) ?? candidate.canonicalUrl
      if (byUrl.has(canonical)) {
        duplicateInRun++
        continue
      }
      byUrl.set(canonical, { ...candidate, canonicalUrl: canonical })
    }

    const known = await loadKnownUrls([...byUrl.keys()])
    // #endregion

    let inserted = 0
    let alreadyKnown = duplicateInRun
    let failed = 0

    for (const [canonical, candidate] of byUrl) {
      if (known.has(canonical)) {
        alreadyKnown++
        continue
      }

      const rawMetadata: RawGrantMetadata = {
        title: candidate.title,
        description: candidate.description,
        funderName: candidate.funderName,
        applicationUrl: candidate.applicationUrl,
        discoveredVia: candidate.discoveredVia,
      }

      try {
        const [stored] = await db
          .insert(grantCandidates)
          .values({
            jobId,
            // A per-candidate sourceId (seed rows) beats the job-level one.
            sourceId: candidate.sourceId ?? sourceId ?? null,
            sourceUrl: candidate.sourceUrl,
            canonicalUrl: canonical,
            rawMetadata,
            // Always pending. Classification and the human decision both come
            // later; discovery has no opinion it is entitled to act on.
            status: 'pending',
          })
          .returning({ id: grantCandidates.id })

        insertedCandidateIds.push(stored.id)
        // Guard against a connector emitting the same page under two different
        // raw URLs that canonicalise identically mid-loop.
        known.add(canonical)
        inserted++
      } catch (err) {
        failed++
        result.errors.push(`[grant-discover] insert failed for ${canonical}: ${String(err)}`)
      }
    }

    // Stamp the sources this run actually touched. Only the connector knows
    // which rows those were, and lastRunAt is what its cadence check reads.
    if (result.touchedSourceIds && result.touchedSourceIds.length > 0) {
      await db
        .update(grantSources)
        .set({ lastRunAt: new Date(), updatedAt: new Date() })
        .where(inArray(grantSources.id, result.touchedSourceIds))
    }

    const stats: GrantDiscoverStats = {
      connector: connector.name,
      discovered: result.candidates.length,
      new: inserted,
      // Discovery never updates anything. Changes to a known grant are the
      // monitor's job, and they land in grant_changes for review.
      updated: 0,
      unchanged: alreadyKnown,
      skipped: result.skipped,
      failed,
      errors: result.errors,
      limits: result.limits,
    }

    await db
      .update(grantCrawlJobs)
      .set({
        status: 'done',
        finishedAt: new Date(),
        // Cast because GrantCrawlStats has no errors/limits fields yet. The
        // column is jsonb, so the extra keys persist and read back fine.
        stats: stats as GrantCrawlStats,
        // The job is 'done', so this column is a summary a human can read at a
        // glance, not a failure. Nothing is hidden by success.
        error: result.errors.length > 0 ? result.errors.slice(0, 20).join('\n') : null,
      })
      .where(eq(grantCrawlJobs.id, jobId))

    for (const limit of result.limits) {
      console.warn(`[grant-discover] ${connector.name} coverage limit: ${limit}`)
    }
    console.log(
      `[grant-discover] ${connector.name} done: ${inserted} new, ${alreadyKnown} already known, ${result.skipped} skipped, ${failed} failed, ${result.errors.length} errors, ${result.limits.length} coverage limits`,
    )

    return { jobId, connector: connector.name, insertedCandidateIds, stats }
  } catch (err) {
    await db
      .update(grantCrawlJobs)
      .set({ status: 'failed', finishedAt: new Date(), error: String(err) })
      .where(eq(grantCrawlJobs.id, jobId))
    if (sourceId) {
      await db
        .update(grantSources)
        .set({ lastError: String(err).slice(0, 500), updatedAt: new Date() })
        .where(eq(grantSources.id, sourceId))
    }
    // Rethrow so BullMQ retries, the same contract as ../jobs/crawl.ts.
    throw err
  }
}
