/**
 * Fill and refresh the team-name cache from The Blue Alliance.
 *
 * A scraped roster, and TBA's own per-event roster read, hand back team NUMBERS
 * with at best a nickname: CORI's list is 48, 144, 379 with no names. The public
 * roster table then shows bare numbers. The `teams` cache (packages/db) turns a
 * number back into a name at render time, and this job is what fills it.
 *
 * It walks TBA's whole team directory once, /teams/{page}/simple, page 0, 1, 2…
 * until a page comes back empty (~20+ pages today), and upserts every team on
 * its number. A weekly schedule is plenty: teams rename between seasons, not
 * between rosters. It is also enqueue-able by hand (a plain add on the queue) so
 * the first backfill can be triggered without waiting for the week to turn.
 *
 * SAME TBA CLIENT AS THE ROSTER REFRESH: the v3 base, the X-TBA-Auth-Key header,
 * and the TBA_API_KEY env var, read exactly as listings/roster-refresh.ts reads
 * them. No key is hardcoded; with no key set the job logs and does nothing.
 */
import { sql } from 'drizzle-orm'
import { getDb, teams as teamsTable } from '@the-tool-pit/db'
import { delay } from '../connectors/base.js'

// `excluded."<col>"` for an ON CONFLICT SET, so the update takes the value the
// row tried to insert rather than a literal restated for every column.
function excluded(column: string) {
  return sql.raw(`excluded."${column}"`)
}

// The same v3 base the roster refresh and the discovery connectors use.
const TBA_BASE = 'https://www.thebluealliance.com/api/v3'

export interface TbaTeamsSyncPayload {
  /**
   * Stop after this many pages. Left unset in normal operation (walk to the
   * empty page); handy only for a bounded manual run.
   */
  maxPages?: number
}

/** One team as TBA's /teams/{page}/simple returns it. */
interface TbaSimpleTeam {
  team_number: number
  nickname: string | null
  name: string | null
  city: string | null
  state_prov: string | null
  country: string | null
}

export interface TbaTeamsSyncStats {
  pages: number
  fetched: number
  upserted: number
  failed: number
}

/**
 * Fetch one page of TBA's team directory.
 *
 * Returns the parsed array, or null on a non-OK response so the caller can stop
 * the walk rather than treat a transport error as "no more teams".
 */
async function fetchTeamsPage(page: number, apiKey: string): Promise<TbaSimpleTeam[] | null> {
  const res = await fetch(`${TBA_BASE}/teams/${page}/simple`, {
    headers: { 'X-TBA-Auth-Key': apiKey },
  })
  if (!res.ok) return null
  return (await res.json()) as TbaSimpleTeam[]
}

export async function processTbaTeamsSyncJob(
  payload: TbaTeamsSyncPayload = {},
): Promise<TbaTeamsSyncStats> {
  const stats: TbaTeamsSyncStats = { pages: 0, fetched: 0, upserted: 0, failed: 0 }

  const apiKey = process.env.TBA_API_KEY
  if (!apiKey) {
    console.warn('[tba-teams-sync] TBA_API_KEY not set, nothing to do')
    return stats
  }

  const db = getDb()
  const maxPages = payload.maxPages ?? Infinity

  let page = 0
  while (page < maxPages) {
    let batch: TbaSimpleTeam[] | null
    try {
      batch = await fetchTeamsPage(page, apiKey)
    } catch (err) {
      stats.failed++
      console.error(`[tba-teams-sync] error fetching page ${page}: ${String(err)}`)
      break
    }

    // A non-OK response or an empty page ends the walk. TBA returns a 200 with
    // [] once past the last populated page, so an empty array is the normal end.
    if (batch === null) {
      console.warn(`[tba-teams-sync] page ${page} returned a non-OK response; stopping`)
      break
    }
    if (batch.length === 0) break

    stats.pages++
    stats.fetched += batch.length

    const rows = batch
      .filter((t) => Number.isInteger(t.team_number))
      .map((t) => ({
        number: t.team_number,
        nickname: t.nickname ?? null,
        name: t.name ?? null,
        city: t.city ?? null,
        stateProv: t.state_prov ?? null,
        country: t.country ?? null,
        updatedAt: new Date(),
      }))

    if (rows.length > 0) {
      try {
        // Upsert on the number: a first run inserts, later runs overwrite the
        // cached strings and bump updatedAt. One statement per page.
        await db
          .insert(teamsTable)
          .values(rows)
          .onConflictDoUpdate({
            target: teamsTable.number,
            set: {
              nickname: excluded('nickname'),
              name: excluded('name'),
              city: excluded('city'),
              stateProv: excluded('state_prov'),
              country: excluded('country'),
              updatedAt: new Date(),
            },
          })
        stats.upserted += rows.length
      } catch (err) {
        stats.failed++
        console.error(`[tba-teams-sync] upsert failed on page ${page}: ${String(err)}`)
      }
    }

    console.log(`[tba-teams-sync] page ${page}: ${batch.length} teams`)
    page++
    // Pace the walk. TBA is other people's server and this is 20+ pages.
    await delay(250)
  }

  console.log(
    `[tba-teams-sync] done — ${stats.pages} pages, ${stats.fetched} teams fetched, ` +
      `${stats.upserted} upserted, ${stats.failed} failed`,
  )
  return stats
}
