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

export const AUTO_ROUTE_CONFIDENCE = 0.85

/** A list page's own name beats a marketing <title>; the host is the last resort. */
function sourceLabel(candidate: GrantCandidate, classification: GrantClassification, host: string): string {
  const meta = (candidate.rawMetadata ?? {}) as { title?: string }
  return (classification.name ?? meta.title ?? host).trim().slice(0, 120) || host
}

export type AutoRouteOutcome = 'routed' | 'already_source' | 'bad_url'

export async function routeAggregatorToSource(
  candidate: GrantCandidate,
  classification: GrantClassification,
): Promise<AutoRouteOutcome> {
  const db = getDb()
  const target = (candidate.canonicalUrl ?? candidate.sourceUrl).trim()

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
