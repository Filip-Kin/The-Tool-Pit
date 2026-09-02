/**
 * Turning a venue into a pin.
 *
 * Shared because two callers need the same lookup and the same strictness: the
 * reader does it when it finds a venue, and Accept does it when a moderator
 * corrects an address in the review form. A second implementation would mean
 * one of them drifting into being less careful.
 *
 * THE RULE: a pin has to be defensible. It needs a real address, or a named
 * venue with a town behind it, and the answer has to land in the state the
 * candidate already claims, because a school name that exists in four states
 * would otherwise pin the wrong one. Vague prose gets nothing: a plausible
 * marker in the wrong car park is worse than an empty map.
 *
 * Zero imports beyond fetch, so both apps can use it.
 */
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
    await new Promise((resolve) => setTimeout(resolve, 1100))
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
