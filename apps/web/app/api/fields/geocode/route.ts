import { type NextRequest, NextResponse } from 'next/server'

/**
 * Forward-geocoding proxy over OpenStreetMap Nominatim, used by the submit and
 * admin pin-drop maps to jump to a typed address. Proxied server-side so we can
 * set a proper User-Agent (Nominatim's usage policy requires one) and keep the
 * caller off a third-party host. Low volume, debounced on the client.
 */
export interface GeocodeResult {
  label: string
  lat: number
  lon: number
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 3) return NextResponse.json([] as GeocodeResult[])

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', q)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '5')
    url.searchParams.set('addressdetails', '0')

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'PracticeFieldMap/1.0 (https://fields.frc.tools; admin@frc.tools)',
        'Accept-Language': 'en',
      },
      // Cache identical lookups at the edge for a day - addresses don't move.
      next: { revalidate: 86400 },
    })
    if (!res.ok) return NextResponse.json([] as GeocodeResult[])

    const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>
    const results: GeocodeResult[] = data
      .map((r) => ({ label: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
    return NextResponse.json(results)
  } catch (err) {
    console.error('[fields/geocode] error', err)
    return NextResponse.json([] as GeocodeResult[])
  }
}
