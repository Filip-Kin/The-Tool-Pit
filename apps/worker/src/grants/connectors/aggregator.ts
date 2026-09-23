/**
 * Aggregator connector: mine the LIST pages for the grants they list.
 *
 * The classifier flags hundreds of pages as isAggregator - a state association's
 * team-grants round-up, a community foundation's funding index, a "grants for
 * robotics teams" blog post. Each one is worth every grant it links to, and
 * until now nothing crawled them: routing an aggregator to grant_sources made a
 * row no connector answered to, so 534 of them sat in the queue as dead ends.
 *
 * This walks enabled grant_sources rows of kind 'aggregator', fetches each list
 * page, and emits one candidate per outbound link that looks like it points at a
 * grant or programme page. Deterministic link heuristics only, no model: the
 * classifier downstream is what decides whether a link was a real grant, and it
 * already rejects junk well. Everything emitted is a CANDIDATE, never a listing.
 *
 * Link selection is the whole job, so the rules are spelled out:
 *   - keep a link when its anchor text OR its path reads like a grant, a fund,
 *     an award, a scholarship or an application;
 *   - drop site furniture (home, contact, login), mailto/tel/javascript, page
 *     anchors, the list page itself, and bare site roots (a homepage is not a
 *     grant page);
 *   - drop hosts that are never a funder (forums, social, shops, shorteners);
 *   - cap per page, so a 400-link directory does not file 400 review chores in
 *     one pass. The cap is reported on limits so it is visible, not silent.
 */
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getDb, grantCandidates, grantSources } from '@the-tool-pit/db'
import { parse } from 'node-html-parser'
import { politeFetch, delay } from '../../connectors/base.js'
import { canonicalGrantUrl, isNonFunderHost } from './shared.js'
import { isSecondhandGrantHost } from '../prefilter.js'
import type {
  GrantConnector,
  GrantConnectorContext,
  GrantConnectorResult,
  GrantCandidateInput,
} from './types.js'

/** Polite gap between list-page fetches. */
const FETCH_DELAY_MS = 1200
/** Most links one list page may file per run. Visible on limits when hit. */
const MAX_LINKS_PER_PAGE = 60

/** Anchor text or URL path that reads like a grant or a way to apply. */
const GRANTY = /\b(grants?|funding|funds?|awards?|scholarships?|apply|applications?|programs?|programmes?|opportunit(y|ies)|sponsorships?|fellowships?|stipends?|mini-?grants?)\b/i
/** Anchor text that is site furniture, whatever the href. */
const FURNITURE = /^(home|about( us)?|contact( us)?|log ?in|sign ?in|sign ?up|menu|search|privacy( policy)?|terms|donate|news|events?|blog|faq|careers|jobs|back|next|previous|more|read more|learn more|click here|share|print|email|subscribe|newsletter|calendar|gallery|photos|store|shop|cart)$/i

/**
 * A source is dead once it has filed this many candidates, published none, and
 * not one of them is still waiting for a human. The 2026-09 review found 1,050
 * auto-routed sources with yield_count 0 whose crawls only ever filed federal,
 * college or directory-metadata pages; crawling them again files more of the same.
 */
export const DEAD_SOURCE_MIN_CANDIDATES = 15

/** The line appended to grant_sources.notes when a source is switched off. */
export function deadSourceNote(now: Date, minCandidates = DEAD_SOURCE_MIN_CANDIDATES): string {
  return (
    `Auto-disabled ${now.toISOString().slice(0, 10)}: ${minCandidates}+ candidates, none published, none pending; ` +
    `every one was suppressed, a duplicate or another list page.`
  )
}

/**
 * Switch off aggregator sources that have proved to yield nothing. One UPDATE
 * with a grouped subquery. A candidate that is pending, flagged, published, or
 * matched to a real grant keeps its source alive; only suppressed, duplicate,
 * and matched-without-a-grant (routed as another list) count as dead.
 */
export async function disableDeadAggregatorSources(now = new Date()): Promise<Array<{ id: string; label: string; target: string }>> {
  const db = getDb()
  const dead = db
    .select({ id: grantCandidates.sourceId })
    .from(grantCandidates)
    .where(isNotNull(grantCandidates.sourceId))
    .groupBy(grantCandidates.sourceId)
    .having(
      sql`count(*) >= ${DEAD_SOURCE_MIN_CANDIDATES} and count(*) filter (where not (
        ${grantCandidates.status} in ('suppressed', 'duplicate')
        or (${grantCandidates.status} = 'matched' and ${grantCandidates.matchedGrantId} is null)
      )) = 0`,
    )

  const disabled = await db
    .update(grantSources)
    .set({
      enabled: false,
      notes: sql`concat_ws(E'\n', ${grantSources.notes}, ${deadSourceNote(now)}::text)`,
      updatedAt: now,
    })
    .where(
      and(
        eq(grantSources.kind, 'aggregator'),
        eq(grantSources.enabled, true),
        eq(grantSources.yieldCount, 0),
        inArray(grantSources.id, dead),
      ),
    )
    .returning({ id: grantSources.id, label: grantSources.label, target: grantSources.target })

  for (const s of disabled) {
    console.log(`[grant-aggregator] auto-disabled dead source "${s.label}" (${s.target}): ${deadSourceNote(now)}`)
  }
  return disabled
}

interface ScoredLink {
  url: string
  text: string
  score: number
}

/**
 * Outbound links on a list page that plausibly point at grant pages, best
 * first. Pure, so it is unit-testable without a fetch.
 */
export function grantLinksOnPage(html: string, pageUrl: string): ScoredLink[] {
  const root = parse(html)
  const pageCanonical = canonicalGrantUrl(pageUrl)
  const seen = new Set<string>()
  const out: ScoredLink[] = []

  for (const a of root.querySelectorAll('a[href]')) {
    const href = (a.getAttribute('href') ?? '').trim()
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue

    let abs: string
    try {
      abs = new URL(href, pageUrl).toString()
    } catch {
      continue
    }
    const canonical = canonicalGrantUrl(abs)
    if (!canonical || canonical === pageCanonical) continue
    if (isNonFunderHost(canonical)) continue
    // A grant database page is secondhand and usually paywalled; the funder's
    // own page is the one worth filing. Same rule the prefilter applies later,
    // applied here so the row is never written at all.
    if (isSecondhandGrantHost(canonical)) continue
    // Index, archive and pagination shapes are lists, not listings.
    if (/\/(category|categories|tag|tags|tagged|topic|topics|archive|archives|search|page\/\d+|author|feed|rss)(\/|$)/i.test(canonical)) continue
    if (/[?&](page|paged|p|s|q|search|tag|cat|category)=/i.test(canonical)) continue
    // A bare site root is a homepage, not a grant page.
    if (/^https?:\/\/[^/]+\/?$/i.test(canonical)) continue
    if (seen.has(canonical)) continue

    const text = a.textContent.replace(/\s+/g, ' ').trim()
    if (!text || text.length > 160 || FURNITURE.test(text)) continue

    let path = ''
    try {
      path = decodeURIComponent(new URL(canonical).pathname)
    } catch {
      path = ''
    }

    let score = 0
    if (GRANTY.test(text)) score += 2
    if (GRANTY.test(path)) score += 1
    // A link has to READ like a grant somewhere, in its text or its path. The
    // short-title bonus below only orders the ones that do; on its own it let
    // a news post and a bare org link through.
    if (score === 0) continue
    // Anchor text that is a sentence is usually a caption or a blurb, not the
    // programme's name; a short title is the better sign.
    if (text.split(' ').length <= 10) score += 1

    seen.add(canonical)
    out.push({ url: canonical, text, score })
  }

  return out.sort((a, b) => b.score - a.score)
}

export class GrantAggregatorConnector implements GrantConnector {
  name = 'grant_aggregator'

  async run(ctx: GrantConnectorContext): Promise<GrantConnectorResult> {
    const db = getDb()
    const candidates: GrantCandidateInput[] = []
    const errors: string[] = []
    const limits: string[] = []
    const touchedSourceIds: string[] = []
    let skipped = 0

    const disabled = await disableDeadAggregatorSources()
    if (disabled.length > 0) limits.push(`${disabled.length} aggregator sources auto-disabled: ${DEAD_SOURCE_MIN_CANDIDATES}+ candidates, none published or pending`)

    const rows = await db
      .select()
      .from(grantSources)
      .where(
        ctx.sourceId
          ? eq(grantSources.id, ctx.sourceId)
          : and(eq(grantSources.kind, 'aggregator'), eq(grantSources.enabled, true)),
      )

    if (rows.length === 0) {
      limits.push('no enabled grant_sources rows of kind aggregator, nothing to walk')
      return { candidates, skipped: 0, errors, limits, touchedSourceIds }
    }

    const now = Date.now()
    const due = ctx.sourceId
      ? rows
      : rows.filter((r) => !r.lastRunAt || now - r.lastRunAt.getTime() >= r.cadenceHours * 3600_000)
    const notDue = rows.length - due.length
    if (notDue > 0) limits.push(`${notDue} of ${rows.length} aggregator sources skipped, not due under cadenceHours`)

    const failed: string[] = []
    const ok: string[] = []

    for (const source of due) {
      touchedSourceIds.push(source.id)
      const config = (source.config ?? {}) as { funderName?: string }

      try {
        const res = await politeFetch(source.target)
        if (!res.ok) {
          errors.push(`[grant-aggregator] HTTP ${res.status} for ${source.target} (${source.label})`)
          failed.push(source.id)
          skipped++
          continue
        }
        const links = grantLinksOnPage(await res.text(), source.target)
        if (links.length > MAX_LINKS_PER_PAGE) {
          limits.push(`"${source.label}" listed ${links.length} grant-like links, only the top ${MAX_LINKS_PER_PAGE} filed`)
        }
        for (const link of links.slice(0, MAX_LINKS_PER_PAGE)) {
          candidates.push({
            sourceUrl: source.target,
            canonicalUrl: link.url,
            title: link.text,
            // Only when the list is a single funder's own index; a round-up of
            // many funders must not stamp one funder on every link.
            funderName: config.funderName,
            discoveredVia: `aggregator:${source.label}`,
            sourceId: source.id,
          })
        }
        ok.push(source.id)
      } catch (err) {
        errors.push(`[grant-aggregator] fetch failed for ${source.target} (${source.label}): ${String(err)}`)
        failed.push(source.id)
        skipped++
      }

      await delay(FETCH_DELAY_MS)
    }

    if (failed.length > 0) {
      await db
        .update(grantSources)
        .set({ lastError: 'fetch failed on last run, see grant_crawl_jobs', updatedAt: new Date() })
        .where(inArray(grantSources.id, failed))
    }
    if (ok.length > 0) {
      await db.update(grantSources).set({ lastError: null, updatedAt: new Date() }).where(inArray(grantSources.id, ok))
    }

    console.log(`[grant-aggregator] ${candidates.length} candidates from ${due.length} due list pages, ${skipped} skipped`)
    return { candidates, skipped, errors, limits, touchedSourceIds }
  }
}
