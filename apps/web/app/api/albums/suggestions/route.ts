import { type NextRequest, NextResponse } from 'next/server'
import { suggestEvents } from '@/lib/queries/albums'

/**
 * Lightweight event autocomplete for the album search bar. No logging.
 * Returns [{ eventCode, name, year }] for the top matches.
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q') ?? ''
  if (!query.trim()) return NextResponse.json([])

  try {
    const events = await suggestEvents(query)
    const suggestions = events.map((e) => ({
      tbaKey: e.tbaKey,
      eventCode: e.eventCode,
      name: e.name,
      year: e.year,
      soleAlbumUrl: e.soleAlbumUrl ?? null,
    }))
    return NextResponse.json(suggestions, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json([])
  }
}
