/**
 * Which FIRST district a grant belongs to.
 *
 * A FIRST district's team grants are for its own teams, and a district is not
 * a set of states: FIRST Mid-Atlantic is New Jersey, Delaware and only eastern
 * Pennsylvania. Its grant was published open to every US team and emailed to
 * teams in Michigan, California and Colorado (2026-11-11). The district list
 * and names are TBA's, read at run time, so a district TBA adds or renames is
 * picked up without a code change.
 */
import { sql } from 'drizzle-orm'
import { getDb, teams } from '@the-tool-pit/db'
import { CA_PROVINCES, US_STATES } from './infer-regions.js'

const TBA_BASE = 'https://www.thebluealliance.com/api/v3'

export interface District {
  /** TBA abbreviation, lower case: 'fma'. */
  code: string
  /** TBA display name: 'FIRST Mid-Atlantic', 'Texas - FIRST Texas'. */
  name: string
}

let cached: { at: number; list: District[] } | null = null

/** TBA's districts for the latest season it lists, cached for a day. Empty with no key or on failure. */
export async function loadDistricts(): Promise<District[]> {
  if (cached && Date.now() - cached.at < 86_400_000) return cached.list
  const key = process.env.TBA_API_KEY
  if (!key) return []
  const year = new Date().getUTCFullYear()
  for (const y of [year + 1, year]) {
    try {
      const res = await fetch(`${TBA_BASE}/districts/${y}`, { headers: { 'X-TBA-Auth-Key': key } })
      if (!res.ok) continue
      const rows = (await res.json()) as Array<{ abbreviation: string; display_name: string }>
      if (rows.length === 0) continue
      cached = { at: Date.now(), list: rows.map((r) => ({ code: r.abbreviation.toLowerCase(), name: r.display_name })) }
      return cached.list
    } catch {
      // try the year before
    }
  }
  return []
}

/** "FIRST Mid-Atlantic" -> "mid atlantic"; "Texas - FIRST Texas" -> "texas". */
function core(name: string): string {
  const last = name.split(' - ').pop() ?? name
  return last
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\bfirst\b/g, ' ')
    .replace(/\b(robotics|district|inc|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // "FIRST in Michigan", "FIRST In Texas": the district is Michigan, Texas.
    .replace(/^in /, '')
}

/**
 * The districts a grant is for, with the words that decided it. A funder that
 * IS a district ("FIRST Mid-Atlantic", "FIRST Wisconsin"), or a name, summary
 * or eligibility line that says "<district> District". Pure.
 */
export function districtsOf(
  input: { funderName?: string | null; texts?: Array<string | null | undefined> },
  list: District[],
): { codes: string[]; quote: string } | null {
  const codes = new Set<string>()
  let quote = ''
  const funder = core(input.funderName ?? '')
  for (const d of list) {
    const c = core(d.name)
    if (!c) continue
    if (funder && funder === c) {
      codes.add(d.code)
      quote ||= `funder ${input.funderName} is the ${d.name} district`
      continue
    }
    const said = new RegExp(`\\b${c.replace(/ /g, '[\\s-]+')}\\s+district\\b`, 'i')
    for (const t of input.texts ?? []) {
      const m = t?.match(said)
      if (m) {
        codes.add(d.code)
        quote ||= m[0]
        break
      }
    }
  }
  return codes.size ? { codes: [...codes].sort(), quote } : null
}

/**
 * The states or provinces a district's teams are in, as codes, from the TBA
 * team cache: every one with at least 3% of the district's teams, so a team
 * registered across a border does not add a state. Empty before the district
 * sync has run, and for a district outside the US and Canada.
 */
export async function districtStates(codes: string[]): Promise<string[]> {
  if (codes.length === 0) return []
  const rows = await getDb()
    .select({ state: teams.stateProv, n: sql<number>`count(*)::int` })
    .from(teams)
    .where(sql`${teams.district} = any(${codes})`)
    .groupBy(teams.stateProv)
  const total = rows.reduce((a, r) => a + r.n, 0)
  const code = (name: string) => {
    const k = name.trim().toLowerCase()
    if (US_STATES[k]) return US_STATES[k]
    if (CA_PROVINCES[k]) return CA_PROVINCES[k]
    return /^[A-Z]{2}$/.test(name.trim()) ? name.trim() : null
  }
  return [...new Set(rows.filter((r) => r.state && r.n / total >= 0.03).map((r) => code(r.state as string)).filter((c): c is string => Boolean(c)))].sort()
}
