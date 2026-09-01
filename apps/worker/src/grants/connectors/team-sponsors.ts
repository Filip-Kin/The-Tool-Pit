/**
 * Team sponsor connector: read who already pays for robotics.
 *
 * This is a discovery SIGNAL, not a listing source. One team thanking Acme
 * Machining means nothing. The same organisation thanked on three unrelated
 * team sites is strong evidence it gives money to robotics teams, well before
 * anybody finds its grant page, and that is what earns a candidate.
 *
 * WHERE THE TEAM WEBSITES COME FROM: they are not in our database. The tables
 * synced from The Blue Alliance for the photos vertical are `events` and
 * `event_teams`, and `event_teams` carries nothing but eventId and teamNumber.
 * There is no teams table and no team website column. So this connector takes
 * the team numbers from event_teams and resolves each team's website from the
 * TBA team endpoint at run time. If a teams table with a website column is
 * added later, drop the per-team API call and read the column instead.
 *
 * Coverage is bounded on purpose: sweeping every FRC team every run would be
 * thousands of requests to volunteer-run websites. Runs take a rotating slice
 * and report the slice size, so the cap is visible rather than assumed.
 */
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { parse } from 'node-html-parser'
import { getDb, events, eventTeams, grantSponsorMentions } from '@the-tool-pit/db'
import { getRedis } from '../../redis.js'
import { politeFetch, delay } from '../../connectors/base.js'
import {
  canonicalGrantUrl,
  hostOf,
  isNonFunderHost,
  looksLikeOrganisationName,
  normaliseFunderKey,
} from './shared.js'
import type {
  GrantConnector,
  GrantConnectorContext,
  GrantConnectorResult,
  GrantCandidateInput,
} from './types.js'

/** Redis cursor, so consecutive runs sweep different teams. */
const CURSOR_KEY = 'grants:sponsors:cursor'

/** Teams per run. Each team costs one TBA call and one or two site fetches. */
const DEFAULT_MAX_TEAMS = 120

/** How far back to look for active teams. A 2014 roster is not a live website. */
const SEASONS_BACK = 3

/**
 * The threshold that turns a mention into a candidate. Three unrelated teams
 * is the point where a name stops being "somebody's uncle's business" and
 * starts being an organisation that funds robotics.
 */
const SPONSOR_THRESHOLD = 3

/** Anchor text or href that suggests a dedicated sponsors page. */
const SPONSOR_LINK_RE = /sponsor|partner|supporter|our-?support|thank/i
/** id or class of a homepage block holding the sponsor logos. */
const SPONSOR_BLOCK_RE = /sponsor|partner|supporter/i

const TBA_BASE = 'https://www.thebluealliance.com/api/v3'

interface TbaTeamSimple {
  team_number: number
  nickname: string | null
  website: string | null
}

interface SponsorMention {
  rawName: string
  funderKey: string
  funderUrl: string | null
}

/**
 * Pull sponsor names and outbound links out of one page.
 * `scoped` is true when we are on a dedicated sponsors page and can trust the
 * whole document; on a homepage we only trust a block that names itself as
 * sponsors, because a homepage's other links are navigation and social icons.
 */
function extractSponsors(html: string, pageUrl: string, scoped: boolean): SponsorMention[] {
  const root = parse(html)
  const teamHost = hostOf(pageUrl)
  const containers = scoped
    ? [root]
    : root
        .querySelectorAll('section, div, footer, ul')
        .filter((el) => SPONSOR_BLOCK_RE.test(`${el.getAttribute('id') ?? ''} ${el.getAttribute('class') ?? ''}`))

  const out: SponsorMention[] = []
  const seenKeys = new Set<string>()

  for (const container of containers) {
    for (const anchor of container.querySelectorAll('a')) {
      const href = anchor.getAttribute('href')?.trim()
      if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue

      let funderUrl: string | null = null
      try {
        const resolved = new URL(href, pageUrl)
        const host = resolved.hostname.toLowerCase().replace(/^www\./, '')
        // An internal link is the team's own page, never the sponsor's.
        if (teamHost && host === teamHost) continue
        if (isNonFunderHost(resolved.toString())) continue
        funderUrl = canonicalGrantUrl(resolved.toString())
      } catch {
        continue
      }
      if (!funderUrl) continue

      // Logo grids have no anchor text, so the image alt is usually the name.
      const img = anchor.querySelector('img')
      const rawName = [
        anchor.textContent?.replace(/\s+/g, ' ').trim(),
        img?.getAttribute('alt')?.trim(),
        img?.getAttribute('title')?.trim(),
        anchor.getAttribute('title')?.trim(),
      ].find((v) => v && looksLikeOrganisationName(v))

      // No usable name means no grouping key, and a key derived from the
      // hostname would not match the same funder written out in words on the
      // next team's site. Drop it rather than pollute the signal.
      if (!rawName) continue

      const funderKey = normaliseFunderKey(rawName)
      if (funderKey.length < 3 || seenKeys.has(funderKey)) continue
      seenKeys.add(funderKey)
      out.push({ rawName, funderKey, funderUrl })
    }
  }

  return out
}

export class GrantTeamSponsorsConnector implements GrantConnector {
  name = 'grant_team_sponsors'

  async run(_ctx: GrantConnectorContext): Promise<GrantConnectorResult> {
    const db = getDb()
    const candidates: GrantCandidateInput[] = []
    const errors: string[] = []
    const limits: string[] = []
    let skipped = 0

    const tbaApiKey = process.env.TBA_API_KEY
    if (!tbaApiKey) {
      // No key means no websites, because we do not store them. Say so loudly:
      // a silent empty run here looks identical to "no teams list sponsors".
      return {
        candidates: [],
        skipped: 0,
        errors: ['TBA_API_KEY is not set, team websites cannot be resolved'],
        limits: ['sponsor sweep did not run'],
      }
    }

    const maxTeams = parseInt(process.env.GRANT_SPONSOR_MAX_TEAMS ?? '', 10) || DEFAULT_MAX_TEAMS
    const sinceYear = new Date().getFullYear() - SEASONS_BACK

    // Recently active FRC teams, most-competed first. Teams that attend more
    // events are more likely to keep a real website with a sponsor page.
    const teamRows = await db
      .select({
        teamNumber: eventTeams.teamNumber,
        appearances: sql<number>`count(*)::int`,
      })
      .from(eventTeams)
      .innerJoin(events, eq(events.id, eventTeams.eventId))
      .where(and(eq(events.program, 'frc'), gte(events.year, sinceYear)))
      .groupBy(eventTeams.teamNumber)
      .orderBy(desc(sql`count(*)`), eventTeams.teamNumber)

    if (teamRows.length === 0) {
      limits.push('no FRC event_teams rows for the last three seasons, nothing to sweep')
      return { candidates, skipped: 0, errors, limits }
    }

    const redis = getRedis()
    const cursor = parseInt((await redis.get(CURSOR_KEY)) ?? '0', 10) || 0
    const start = cursor % teamRows.length
    const slice: typeof teamRows = []
    for (let i = 0; i < Math.min(maxTeams, teamRows.length); i++) {
      slice.push(teamRows[(start + i) % teamRows.length])
    }
    await redis.set(CURSOR_KEY, String(cursor + slice.length))

    if (slice.length < teamRows.length) {
      limits.push(
        `per-run cap: swept ${slice.length} of ${teamRows.length} active FRC teams, cursor at ${cursor}, the rest are swept on later passes`,
      )
    }

    let teamsWithSite = 0
    let mentionsWritten = 0

    for (const team of slice) {
      // #region resolve the team website from TBA
      let website: string | null = null
      try {
        const res = await politeFetch(`${TBA_BASE}/team/frc${team.teamNumber}`, {
          headers: { 'X-TBA-Auth-Key': tbaApiKey },
        })
        if (res.ok) {
          const data = (await res.json()) as TbaTeamSimple
          website = data.website
        } else if (res.status !== 404) {
          errors.push(`[grant-sponsors] TBA HTTP ${res.status} for team ${team.teamNumber}`)
        }
      } catch (err) {
        errors.push(`[grant-sponsors] TBA fetch failed for team ${team.teamNumber}: ${String(err)}`)
      }
      await delay(300)

      if (!website || isNonFunderHost(website)) {
        // Plenty of teams list a Facebook page or nothing at all.
        skipped++
        continue
      }
      teamsWithSite++
      // #endregion

      // #region find and read the sponsors page
      let pageUrl = website
      let html: string | null = null
      try {
        const res = await politeFetch(website)
        if (!res.ok) {
          skipped++
          await delay(800)
          continue
        }
        html = await res.text()
      } catch {
        // Team sites go down constantly. Not worth an error line each.
        skipped++
        await delay(800)
        continue
      }

      // Prefer a dedicated sponsors page: on those, every outbound link is a
      // sponsor, so we do not have to guess which block on the homepage counts.
      let scoped = false
      try {
        const root = parse(html)
        for (const anchor of root.querySelectorAll('a')) {
          const href = anchor.getAttribute('href')
          if (!href) continue
          const text = anchor.textContent?.trim() ?? ''
          if (!SPONSOR_LINK_RE.test(text) && !SPONSOR_LINK_RE.test(href)) continue
          const resolved = new URL(href, website)
          if (hostOf(resolved.toString()) !== hostOf(website)) continue
          await delay(800)
          const sponsorRes = await politeFetch(resolved.toString())
          if (sponsorRes.ok) {
            html = await sponsorRes.text()
            pageUrl = resolved.toString()
            scoped = true
          }
          break
        }
      } catch {
        // Fall back to the homepage block scan.
      }
      // #endregion

      const mentions = extractSponsors(html, pageUrl, scoped)
      if (mentions.length === 0) {
        skipped++
        await delay(800)
        continue
      }

      for (const mention of mentions) {
        try {
          await db
            .insert(grantSponsorMentions)
            .values({
              funderKey: mention.funderKey,
              rawName: mention.rawName,
              program: 'frc',
              teamNumber: team.teamNumber,
              sourceUrl: pageUrl,
              funderUrl: mention.funderUrl,
            })
            // Same team, same funder, seen again: refresh the URL and the name
            // the team currently uses rather than stacking duplicate rows.
            .onConflictDoUpdate({
              target: [
                grantSponsorMentions.funderKey,
                grantSponsorMentions.program,
                grantSponsorMentions.teamNumber,
              ],
              set: {
                rawName: mention.rawName,
                sourceUrl: pageUrl,
                funderUrl: mention.funderUrl,
              },
            })
          mentionsWritten++
        } catch (err) {
          errors.push(`[grant-sponsors] mention upsert failed for ${mention.funderKey}: ${String(err)}`)
        }
      }

      await delay(800)
    }

    // #region roll mentions up into candidates
    // Counted across the whole table, not just this run: the third team that
    // names a funder may have been swept weeks ago, and that is still the
    // moment the signal crosses the threshold.
    const teamCount = sql<number>`count(distinct ${grantSponsorMentions.teamNumber})::int`
    const crossed = await db
      .select({
        funderKey: grantSponsorMentions.funderKey,
        teams: teamCount,
        rawName: sql<string>`max(${grantSponsorMentions.rawName})`,
        funderUrl: sql<string>`max(${grantSponsorMentions.funderUrl})`,
        sourceUrl: sql<string>`max(${grantSponsorMentions.sourceUrl})`,
      })
      .from(grantSponsorMentions)
      .where(
        and(
          isNull(grantSponsorMentions.dismissedAt),
          // Already rolled into a funder record, so it needs no fresh lead.
          isNull(grantSponsorMentions.resolvedFunderId),
        ),
      )
      .groupBy(grantSponsorMentions.funderKey)
      .having(sql`count(distinct ${grantSponsorMentions.teamNumber}) >= ${SPONSOR_THRESHOLD}`)

    for (const row of crossed) {
      // No URL means no page to review, so the mention stays a mention.
      if (!row.funderUrl) {
        skipped++
        continue
      }
      const canonicalUrl = canonicalGrantUrl(row.funderUrl)
      if (!canonicalUrl) {
        skipped++
        continue
      }
      candidates.push({
        sourceUrl: row.sourceUrl,
        canonicalUrl,
        title: row.rawName,
        description: `Named as a sponsor by ${row.teams} unrelated FRC teams. This is a discovery signal, not a confirmed grant programme: the funder's own page still has to say whether teams can apply.`,
        funderName: row.rawName,
        discoveredVia: `team_sponsors:${row.teams} teams`,
      })
    }
    // #endregion

    console.log(
      `[grant-sponsors] ${slice.length} teams swept, ${teamsWithSite} with a usable site, ${mentionsWritten} mentions, ${candidates.length} candidates over the ${SPONSOR_THRESHOLD}-team threshold`,
    )
    return { candidates, skipped, errors, limits }
  }
}
