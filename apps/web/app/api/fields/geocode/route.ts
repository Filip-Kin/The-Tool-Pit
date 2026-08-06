import { type NextRequest, NextResponse } from 'next/server'

/**
 * Geocoding proxy over OpenStreetMap Nominatim for the submit/admin pin-drop
 * maps. Two modes:
 *   forward: ?q=<address>        -> a list of matches (with structured parts)
 *   reverse: ?lat=<>&lon=<>      -> the address parts at that point
 * Proxied server-side so we can set a proper User-Agent (Nominatim's usage
 * policy requires one). Low volume, debounced/discrete on the client.
 */
export interface AddressParts {
  address?: string
  city?: string
  region?: string
  country?: string
}

export interface GeocodeResult extends AddressParts {
  label: string
  lat: number
  lon: number
}

const UA = 'PracticeFieldMap/1.0 (https://fields.filipkin.com; admin@frc.tools)'

interface NominatimAddress {
  house_number?: string
  road?: string
  city?: string
  town?: string
  village?: string
  hamlet?: string
  municipality?: string
  suburb?: string
  state?: string
  province?: string
  region?: string
  country?: string
  country_code?: string
  ['ISO3166-2-lvl4']?: string
}

/** Turn a Nominatim address object into the four fields our form uses. */
function parseAddress(a: NominatimAddress | undefined): AddressParts {
  if (!a) return {}
  const road = [a.house_number, a.road].filter(Boolean).join(' ')
  const iso = a['ISO3166-2-lvl4'] // e.g. "US-MI" -> "MI" (matches the abbreviated placeholder)
  const region = iso && iso.includes('-') ? iso.split('-').pop() : a.state || a.province || a.region
  return {
    address: road || undefined,
    city: a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || undefined,
    region: region || undefined,
    country: a.country || undefined,
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const lat = sp.get('lat')
  const lon = sp.get('lon')

  try {
    // Reverse: coordinates -> address parts.
    if (lat && lon && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
      const url = new URL('https://nominatim.openstreetmap.org/reverse')
      url.searchParams.set('lat', lat)
      url.searchParams.set('lon', lon)
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('addressdetails', '1')
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } })
      if (!res.ok) return NextResponse.json({} as AddressParts)
      const data = (await res.json()) as { address?: NominatimAddress }
      return NextResponse.json(parseAddress(data.address))
    }

    // Forward: query -> list of matches.
    const q = sp.get('q')?.trim()
    if (!q || q.length < 3) return NextResponse.json([] as GeocodeResult[])

    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', q)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '5')
    url.searchParams.set('addressdetails', '1')
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      next: { revalidate: 86400 },
    })
    if (!res.ok) return NextResponse.json([] as GeocodeResult[])

    const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string; address?: NominatimAddress }>
    const results: GeocodeResult[] = data
      .map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon), ...parseAddress(r.address) }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
    return NextResponse.json(results)
  } catch (err) {
    console.error('[fields/geocode] error', err)
    return NextResponse.json(lat && lon ? ({} as AddressParts) : ([] as GeocodeResult[]))
  }
}
