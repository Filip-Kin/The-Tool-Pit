/**
 * Seed connector: walk the curated grant_sources rows of kind 'seed'.
 *
 * Each seed row is a page a human already decided is worth watching: a funder's
 * grants page, or a specific programme's page. The connector fetches it, reads
 * deterministic metadata, and emits exactly one candidate per source. It does
 * not follow links and it does not try to be clever, because the whole point of
 * a seed is that a human chose the URL.
 *
 * Seeds still produce CANDIDATES, not listings. A curated URL tells us where to
 * look; it does not tell us the deadline, and a wrong deadline is worse than no
 * deadline.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { getDb, grantSources } from '@the-tool-pit/db'
import { politeFetch, delay } from '../../connectors/base.js'
import { canonicalGrantUrl, readPageMetadata } from './shared.js'
import type {
  GrantConnector,
  GrantConnectorContext,
  GrantConnectorResult,
  GrantCandidateInput,
} from './types.js'

/** Polite gap between seed fetches. Seeds are few and never urgent. */
const FETCH_DELAY_MS = 1200

// #region Curated starter list

/**
 * Real, well-known funders of FIRST teams, for an admin to load as grant_sources
 * rows in one click.
 *
 * The rule for this list is correctness over length. Everything here is an
 * organisation we are confident exists and that gives money (or in-kind
 * equipment) to youth robotics teams. Where we are NOT confident that the exact
 * URL is the current grants page, the row carries needsVerification: true, and
 * the loader is expected to surface that to the admin rather than trust it. We
 * do not invent deep links: a guessed URL that 404s teaches the crawler
 * nothing, and a guessed URL that resolves to the wrong programme is worse.
 */
export interface SeedSourceDefinition {
  label: string
  url: string
  funderName: string
  /**
   * True when the organisation is real and funds teams, but we have not
   * confirmed that this exact URL is the live grants page. An admin confirms
   * before the row is enabled.
   */
  needsVerification: boolean
  notes: string
}

export const SEED_SOURCES: SeedSourceDefinition[] = [
  {
    label: 'FIRST resource library (team grant resources)',
    url: 'https://www.firstinspires.org/resource-library',
    funderName: 'FIRST',
    needsVerification: true,
    notes:
      'FIRST publishes team grant opportunities inside its resource library. The library URL is stable, the grants landing page inside it is not, so confirm the exact page before enabling this row.',
  },
  {
    label: 'Gene Haas Foundation',
    url: 'https://www.ghaasfoundation.org',
    funderName: 'Gene Haas Foundation',
    needsVerification: false,
    notes:
      'The best known cash grant for FRC and FTC teams. Applications run through the foundation site on an annual cycle.',
  },
  {
    label: 'NASA Robotics Alliance Project',
    url: 'https://robotics.nasa.gov',
    funderName: 'NASA',
    needsVerification: true,
    notes:
      'NASA has funded FRC teams through the Robotics Alliance Project, but the grant round has opened and closed in different years and has not always been offered. Confirm the current round before enabling.',
  },
  {
    label: 'DoD STEM',
    url: 'https://www.dodstem.us',
    funderName: 'US Department of Defense STEM',
    needsVerification: true,
    notes:
      'DoD STEM funds youth STEM programmes including robotics. The site is stable, the funding opportunities page moves between seasons, so confirm the current path.',
  },
  {
    label: 'Argosy Foundation',
    url: 'https://www.argosyfnd.org',
    funderName: 'Argosy Foundation',
    needsVerification: true,
    notes:
      'A long-running supporter of FIRST teams. Confirm whether the current cycle takes unsolicited applications, since some years are invitation only.',
  },
  {
    label: 'Motorola Solutions Foundation',
    url: 'https://www.motorolasolutions.com',
    funderName: 'Motorola Solutions Foundation',
    needsVerification: true,
    notes:
      'Runs an annual innovation generation grant covering STEM education including robotics teams. Root domain only here, the foundation page path is not confirmed.',
  },
  {
    label: 'Bosch Community Fund',
    url: 'https://www.bosch.us',
    funderName: 'Bosch Community Fund',
    needsVerification: true,
    notes:
      'Funds STEM education in the US communities where Bosch operates, which makes it geographically scoped. Root domain only, the community fund path is not confirmed.',
  },
  {
    label: 'SME Education Foundation',
    url: 'https://www.smeef.org',
    funderName: 'SME Education Foundation',
    needsVerification: true,
    notes:
      'Funds manufacturing and engineering education for young people, and has supported robotics teams. Confirm the current application route.',
  },
  {
    label: 'American Honda Foundation',
    url: 'https://www.honda.com',
    funderName: 'American Honda Foundation',
    needsVerification: true,
    notes:
      'Grants to youth STEM education programmes in the US. Root domain only, the foundation application page path is not confirmed.',
  },
]

// #endregion

export class GrantSeedConnector implements GrantConnector {
  name = 'grant_seed'

  async run(ctx: GrantConnectorContext): Promise<GrantConnectorResult> {
    const db = getDb()
    const candidates: GrantCandidateInput[] = []
    const errors: string[] = []
    const limits: string[] = []
    const touchedSourceIds: string[] = []
    let skipped = 0

    // A scheduled sweep first makes sure every SEED_SOURCES definition has a
    // row to be seen on the admin sources screen. They go in DISABLED, so
    // loading the list never causes a fetch: a URL flagged needsVerification is
    // one we believe exists but have not confirmed is the live grants page, and
    // an unconfirmed URL that a crawler follows is how a directory fills with
    // the wrong programme. A human enables each row after checking it.
    //
    // Done here rather than in an admin action because SEED_SOURCES lives in
    // this package and the web app cannot import from apps/worker. Rows an
    // admin has since disabled or edited are left alone: the match is on
    // target, and nothing is ever updated, only inserted when missing.
    if (!ctx.sourceId) {
      const loaded = await this.loadSeedDefinitions(limits)
      if (loaded > 0) console.log(`[grant_seed] added ${loaded} seed source row(s), all disabled pending review`)
    }

    const rows = await db
      .select()
      .from(grantSources)
      .where(
        ctx.sourceId
          ? eq(grantSources.id, ctx.sourceId)
          : and(eq(grantSources.kind, 'seed'), eq(grantSources.enabled, true)),
      )

    if (rows.length === 0) {
      // Not an error. Every seed row starts disabled, so an empty result is the
      // normal state until an admin has confirmed at least one URL, and saying
      // so beats an empty successful run.
      limits.push('no enabled grant_sources rows of kind seed, nothing to walk')
      return { candidates, skipped: 0, errors, limits, touchedSourceIds }
    }

    const now = Date.now()
    // A hand requeue (ctx.sourceId) always runs. A scheduled sweep respects
    // cadenceHours, otherwise every pass re-fetches every funder page and we
    // look like a bot to the people we are asking for money.
    const due = ctx.sourceId
      ? rows
      : rows.filter(
          (r) => !r.lastRunAt || now - r.lastRunAt.getTime() >= r.cadenceHours * 3600_000,
        )

    const notDue = rows.length - due.length
    if (notDue > 0) {
      limits.push(`${notDue} of ${rows.length} seed sources skipped, not due under cadenceHours`)
    }

    const failedSourceIds: string[] = []
    const okSourceIds: string[] = []

    for (const source of due) {
      touchedSourceIds.push(source.id)
      const config = (source.config ?? {}) as {
        funderName?: string
        applicationUrl?: string
      }

      const canonicalUrl = canonicalGrantUrl(source.target)
      if (!canonicalUrl) {
        const msg = `[grant-seed] source "${source.label}" has an unparseable target: ${source.target}`
        errors.push(msg)
        failedSourceIds.push(source.id)
        skipped++
        continue
      }

      try {
        // Fetch the curated target verbatim, not the canonical form. The
        // canonical form drops `ref` and `source` parameters, which a few
        // funder CMSes actually route on, and a human chose this exact URL.
        const res = await politeFetch(source.target)
        if (!res.ok) {
          // A 403 here is usually a bot wall rather than a dead page, so keep
          // the source and let the admin see the repeated failure.
          const msg = `[grant-seed] HTTP ${res.status} for ${canonicalUrl} (${source.label})`
          errors.push(msg)
          failedSourceIds.push(source.id)
          skipped++
          continue
        }

        const meta = readPageMetadata(await res.text())
        candidates.push({
          sourceUrl: source.target,
          canonicalUrl,
          // The curated label beats a marketing <title> like "Home | Acme".
          title: source.label || meta.title || canonicalUrl,
          description: meta.description ?? (meta.text.slice(0, 600) || undefined),
          funderName: config.funderName ?? meta.siteName,
          applicationUrl: config.applicationUrl,
          discoveredVia: `seed:${source.label}`,
          sourceId: source.id,
        })
        okSourceIds.push(source.id)
      } catch (err) {
        errors.push(`[grant-seed] fetch failed for ${canonicalUrl} (${source.label}): ${String(err)}`)
        failedSourceIds.push(source.id)
        skipped++
      }

      await delay(FETCH_DELAY_MS)
    }

    // Per-source bookkeeping lives here because only this connector knows which
    // individual row failed. discover.ts stamps lastRunAt for the whole batch.
    if (failedSourceIds.length > 0) {
      await db
        .update(grantSources)
        .set({ lastError: 'fetch failed on last run, see grant_crawl_jobs', updatedAt: new Date() })
        .where(inArray(grantSources.id, failedSourceIds))
    }
    if (okSourceIds.length > 0) {
      await db
        .update(grantSources)
        .set({ lastError: null, updatedAt: new Date() })
        .where(inArray(grantSources.id, okSourceIds))
    }

    console.log(
      `[grant-seed] ${candidates.length} candidates from ${due.length} due sources, ${skipped} skipped`,
    )
    return { candidates, skipped, errors, limits, touchedSourceIds }
  }

  /**
   * Insert a disabled grant_sources row for every SEED_SOURCES entry that has
   * none yet, and report how many curated funders are still switched off.
   *
   * Returns the number of rows inserted. The "still disabled" count goes on
   * limits rather than into a log line, because a run that walked two of nine
   * curated funders is a bounded run, and bounded runs have to be visible on
   * the admin screen or they read as complete coverage.
   */
  private async loadSeedDefinitions(limits: string[]): Promise<number> {
    const db = getDb()

    const existing = await db
      .select({ target: grantSources.target, enabled: grantSources.enabled })
      .from(grantSources)
      .where(eq(grantSources.kind, 'seed'))

    const known = new Set(existing.map((r) => r.target))
    const missing = SEED_SOURCES.filter((s) => !known.has(s.url))

    if (missing.length > 0) {
      await db.insert(grantSources).values(
        missing.map((s) => ({
          kind: 'seed',
          label: s.label,
          target: s.url,
          enabled: false,
          // A funder's grants page is republished once a season at most, so a
          // weekly re-read is already generous.
          cadenceHours: 168,
          config: { funderName: s.funderName, needsVerification: s.needsVerification },
          notes: s.needsVerification
            ? `URL NOT CONFIRMED as the live grants page. Check it before enabling. ${s.notes}`
            : s.notes,
        })),
      )
    }

    const stillDisabled = existing.filter((r) => !r.enabled).length + missing.length
    if (stillDisabled > 0) {
      limits.push(
        `${stillDisabled} of ${SEED_SOURCES.length} curated seed sources are disabled, waiting for a human to confirm the URL`,
      )
    }

    return missing.length
  }
}
