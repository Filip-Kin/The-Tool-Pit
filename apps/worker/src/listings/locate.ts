/**
 * Turn a venue into a pin, and a forum event into its TBA code.
 *
 * Both of these are lookups a person does by hand and then gets asked why the
 * computer did not. A listing needs coordinates before it can go on the map,
 * and the venue and address are already sitting on the candidate: "Capistrano
 * Valley High School, Mission Viejo, CA" is a map search, not a judgement.
 *
 * THE RULE IS THE SAME AS EVERYWHERE ELSE: a value has to come from somewhere
 * checkable. A geocode is only accepted when the answer lands in the state the
 * candidate already says it is in, and when the query had a real address or a
 * named venue with a town behind it. "Just north of Grand Rapids" gets no pin,
 * because a plausible pin in the wrong car park is worse than an empty map.
 */
import { delay } from '../connectors/base.js'

const NOMINATIM = 'https://nominatim.openstreetmap.org'
const TBA_BASE = 'https://www.thebluealliance.com/api/v3'

/** Nominatim's usage policy requires a real one, with a way to complain. */
const UA = 'TheToolPit/1.0 (+https://frc.tools; admin@frc.tools)'

export interface Located {
  latitude: number
  longitude: number
  /** The query that produced it, kept as the evidence for a pin. */
  query: string
  /** The full address Nominatim resolved, for the reviewer to sanity check. */
  resolved: string
}

interface NominatimResult {
  lat: string
  lon: string
  display_name: string
  address?: Record<string, string>
}

/**
 * Coordinates for a venue, or null.
 *
 * Tries the most specific query first: a street address is unambiguous, a
 * venue name plus a town is usually unambiguous, and a town on its own is not
 * worth a pin because it would drop the marker in the middle of a suburb and
 * claim that is where the event is.
 */
export async function geocodeVenue(input: {
  venueName?: string | null
  address?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
}): Promise<Located | null> {
  const place = [input.city, input.region, input.country].filter(Boolean).join(', ')

  const queries: string[] = []
  if (input.address && input.city) queries.push([input.address, place].filter(Boolean).join(', '))
  if (input.venueName && input.city) queries.push([input.venueName, place].filter(Boolean).join(', '))
  // A venue with no town at all is worth one try: school names are distinctive.
  if (input.venueName && !input.city && input.region) queries.push(`${input.venueName}, ${input.region}`)

  for (const query of queries) {
    const found = await searchOnce(query)
    if (!found) continue

    // The answer has to agree with what we already believe. A school name that
    // exists in four states will otherwise pin the wrong one.
    if (input.region && !regionMatches(found, input.region)) {
      console.warn(`[locate] "${query}" resolved to ${found.display_name}, which is not in ${input.region}`)
      continue
    }

    return {
      latitude: Number(found.lat),
      longitude: Number(found.lon),
      query,
      resolved: found.display_name,
    }
  }

  return null
}

async function searchOnce(query: string): Promise<NominatimResult | null> {
  try {
    const url = `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=1`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) return null
    const rows = (await res.json()) as NominatimResult[]
    return rows[0] ?? null
  } catch {
    return null
  } finally {
    // Nominatim asks for no more than one request a second, and means it.
    await delay(1100)
  }
}

/** Whether a result sits in the state or province the candidate claims. */
function regionMatches(result: NominatimResult, region: string): boolean {
  const want = region.trim().toLowerCase()
  const iso = result.address?.['ISO3166-2-lvl4']?.split('-').pop()?.toLowerCase()
  const state = result.address?.state?.toLowerCase()
  const display = result.display_name.toLowerCase()

  if (iso && iso === want) return true
  if (state && (state === want || state.startsWith(want))) return true
  // A two-letter code will not appear in the display name, but a full state
  // name might, e.g. "California" for "CA".
  return want.length > 2 && display.includes(want)
}

// #region TBA

interface TbaEvent {
  key: string
  name: string
  start_date: string | null
  end_date: string | null
  city: string | null
  state_prov: string | null
  event_type: number | null
}

/** How alike two event names are, ignoring years, punctuation and case. */
export function nameCloseness(a: string, b: string): number {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b20\d\d\b/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)

  const left = clean(a)
  const right = new Set(clean(b))
  if (left.length === 0 || right.size === 0) return 0
  const shared = left.filter((w) => right.has(w)).length
  return shared / Math.max(left.length, right.size)
}

/**
 * The TBA event this candidate is, or null.
 *
 * A forum thread carries no TBA code, and having one is what lets the roster
 * refresh keep the registered team count current afterwards. So it is worth
 * looking, and worth being strict: attaching a listing to the wrong TBA event
 * would show a team the wrong roster and the wrong dates for the rest of the
 * season.
 *
 * THE DATE IS THE ANCHOR. Off-season events are named alike ("Fall Classic"
 * exists in three states), so the match needs the dates to line up AND either
 * the town or a clearly similar name.
 */
export async function matchTbaEvent(input: {
  name: string
  startDate?: string | null
  city?: string | null
  region?: string | null
}): Promise<{ tbaKey: string; why: string } | null> {
  const apiKey = process.env.TBA_API_KEY
  if (!apiKey || !input.startDate) return null

  const year = Number(input.startDate.slice(0, 4))
  if (!Number.isFinite(year)) return null

  let events: TbaEvent[]
  try {
    const res = await fetch(`${TBA_BASE}/events/${year}`, { headers: { 'X-TBA-Auth-Key': apiKey } })
    if (!res.ok) return null
    events = (await res.json()) as TbaEvent[]
  } catch {
    return null
  }

  const wantStart = Date.parse(`${input.startDate}T00:00:00Z`)
  const city = input.city?.trim().toLowerCase()
  const region = input.region?.trim().toLowerCase()

  const scored = events
    // Off-season and pre-season only. An off-season event is never a district
    // qualifier, and matching one would be a serious mislabel.
    .filter((e) => e.event_type === 99 || e.event_type === 100)
    .map((e) => {
      const start = e.start_date ? Date.parse(`${e.start_date}T00:00:00Z`) : NaN
      const daysApart = Number.isFinite(start) ? Math.abs(start - wantStart) / 86_400_000 : 99
      const sameCity = Boolean(city && e.city && e.city.trim().toLowerCase() === city)
      const sameRegion = Boolean(region && e.state_prov && e.state_prov.trim().toLowerCase().startsWith(region))
      return { event: e, daysApart, sameCity, sameRegion, closeness: nameCloseness(input.name, e.name) }
    })
    // A day either side, because a listing may date from the Friday load-in
    // and TBA from the Saturday.
    .filter((m) => m.daysApart <= 1)
    .sort((a, b) => b.closeness - a.closeness)

  const best = scored[0]
  if (!best) return null

  // Dates alone are not enough: a given weekend has a dozen off-season events.
  if (best.sameCity && best.closeness >= 0.3) {
    return { tbaKey: best.event.key, why: `same town and dates as ${best.event.name}` }
  }
  if (best.closeness >= 0.6 && (best.sameRegion || !region)) {
    return { tbaKey: best.event.key, why: `name and dates match ${best.event.name}` }
  }

  return null
}

// #endregion
