import { type NextRequest, NextResponse } from 'next/server'
import { searchEvents } from '@/lib/queries/albums'

/** Event search endpoint (name or code). Used by client-side interactions. */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const query = searchParams.get('q') ?? ''
  const year = searchParams.get('year')
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  if (!query.trim()) return NextResponse.json({ events: [], total: 0 })

  try {
    const results = await searchEvents({
      query,
      year: year ? parseInt(year, 10) : undefined,
      page: Number.isFinite(page) ? page : 1,
      pageSize: 20,
    })
    return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[albums/search] error', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
