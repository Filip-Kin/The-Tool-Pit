/**
 * Turn a confidently-classified aggregator into a crawl source, automatically.
 *
 * The admin queue has a "route to source" button (apps/web .../grants/candidates
 * /actions.ts routeGrantCandidateToSource). It creates the row DISABLED, on the
 * reasoning that a human should confirm a URL before a crawler follows it. That
 * was right when nothing crawled aggregators; it is what left 534 list pages
 * sitting in the pending queue for a click each.
 *
 * Now the aggregator connector mines these, so the safe thing has flipped: the
 * risk of a wrong list page is bounded by the classifier downstream (every link
 * it files is still classified, junk is still suppressed, and nothing here can
 * publish). The cost of NOT routing is a queue nobody will clear. So a page the
 * classifier is at least AUTO_ROUTE_CONFIDENCE sure is a list goes in ENABLED,
 * marked as auto-routed so an admin can tell it from a confirmed one and switch
 * it off. Below that confidence it stays pending for the human button, exactly
 * as before.
 */
import { eq } from 'drizzle-orm'
import { getDb, grantCandidates, grantSources } from '@the-tool-pit/db'
import type { GrantCandidate, GrantClassification } from '@the-tool-pit/db'
import { isSecondhandGrantHost } from './prefilter.js'

export const AUTO_ROUTE_CONFIDENCE = 0.85

/**
 * Hosts whose list pages are never auto-routed, whatever the confidence.
 *
 * Evidence, 2026-09-23: 772 grantable.co, 181 instrumentl.com, 31
 * stemgrants.com, 34 ed.gov, 12 ed.sc.gov, 12 zeffy.com, 4 grantwatch, 4
 * grantexec and 4 tgci sources had all been auto-routed and every one had
 * yield_count 0. A grant-finder's list links to more of its own profiles, not
 * to funders; an agency index links to federal and college programmes a team
 * cannot apply to. The classifier is right that these are lists, they are just
 * not lists worth crawling, so they wait for the human button instead.
 */
export const AUTO_ROUTE_DENY_HOSTS: Readonly<Record<string, string>> = {
  'grantable.co': 'grant-finder directory; its lists link to its own funder profiles, not to funders',
  'instrumentl.com': 'grant-finder directory built from tax filings; paywalled profiles',
  'stemgrants.com': 'grant-finder directory; links to its own summaries',
  'grantwatch.com': 'grant-finder directory; paywalled listings',
  'grantexec.com': 'grant-finder directory; paywalled listings',
  'tgci.com': 'grant-finder directory; state funding lists of foundation profiles',
  'zeffy.com': 'grant-finder profiles generated from tax filings',
  'fundsforngos.org': 'grant-finder directory; international NGO calls',
  'ed.gov': 'federal agency programme index; formula grants to states, districts and colleges',
  'ed.sc.gov': 'state agency programme index; allocations to districts, not team grants',
}

/** Why a URL may not be auto-routed, or null when it may. */
export function autoRouteDenyReason(url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  for (const [deny, reason] of Object.entries(AUTO_ROUTE_DENY_HOSTS)) {
    if (host === deny || host.endsWith(`.${deny}`)) return `${deny}: ${reason}`
  }
  if (isSecondhandGrantHost(url)) return `${host}: secondhand grant database`
  return null
}

/** True when a list page on this host must wait for a human, not be auto-routed. */
export function isAutoRouteDeniedHost(url: string): boolean {
  return autoRouteDenyReason(url) !== null
}

/** A list page's own name beats a marketing <title>; the host is the last resort. */
function sourceLabel(candidate: GrantCandidate, classification: GrantClassification, host: string): string {
  const meta = (candidate.rawMetadata ?? {}) as { title?: string }
  return (classification.name ?? meta.title ?? host).trim().slice(0, 120) || host
}

export type AutoRouteOutcome = 'routed' | 'already_source' | 'bad_url' | 'denied_host'

export async function routeAggregatorToSource(
  candidate: GrantCandidate,
  classification: GrantClassification,
): Promise<AutoRouteOutcome> {
  const target = (candidate.canonicalUrl ?? candidate.sourceUrl).trim()
  // Left pending, untouched, exactly as a list below the confidence bar is.
  const denied = autoRouteDenyReason(target)
  if (denied) {
    console.log(`[grant-route] not auto-routing ${target}: ${denied}; left pending for a human`)
    return 'denied_host'
  }
  const db = getDb()

  let host: string
  try {
    host = new URL(target).hostname.replace(/^www\./, '')
  } catch {
    return 'bad_url'
  }

  const [existing] = await db
    .select({ id: grantSources.id })
    .from(grantSources)
    .where(eq(grantSources.target, target))
    .limit(1)

  const meta = (candidate.rawMetadata ?? {}) as { funderName?: string }
  const label = sourceLabel(candidate, classification, host)

  if (!existing) {
    await db.insert(grantSources).values({
      kind: 'aggregator',
      label,
      target,
      enabled: true,
      // A list page changes about as often as a funder's own grants page.
      cadenceHours: 168,
      config: {
        funderName: classification.funderName ?? meta.funderName ?? null,
        fromCandidateId: candidate.id,
        autoRouted: true,
        autoRouteConfidence: classification.confidence ?? null,
      },
      notes:
        `Auto-routed from the candidate queue: the classifier was ${((classification.confidence ?? 0) * 100).toFixed(0)}% sure this is a list of grants. ` +
        `Classifier said: ${classification.reasoning ?? 'no reasoning recorded'} ` +
        `Switch it off if the crawl files junk.`,
    })
  }

  await db
    .update(grantCandidates)
    .set({
      status: 'matched',
      rejectionReason: existing
        ? `Aggregator: already a crawl source ("${label}")`
        : `Auto-routed to grant_sources as an aggregator: "${label}" (enabled, crawled by grant_aggregator)`,
      updatedAt: new Date(),
    })
    .where(eq(grantCandidates.id, candidate.id))

  return existing ? 'already_source' : 'routed'
}
