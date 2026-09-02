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
// The geocoder is shared with the web app's Accept action, so it lives in
// packages/db beside the other zero-dependency helpers.
export { geocodeVenue, type Located } from '@the-tool-pit/db/geocode'

const TBA_BASE = 'https://www.thebluealliance.com/api/v3'

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
