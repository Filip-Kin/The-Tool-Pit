import { type NextRequest, NextResponse } from 'next/server'
import { searchTools } from '@/lib/search/search'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const query = searchParams.get('q') ?? ''
  const program = searchParams.get('program') ?? undefined
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  try {
    const results = await searchTools({
      query,
      program: program as 'frc' | 'ftc' | 'fll' | undefined,
      page,
      pageSize: 20,
    })
    return NextResponse.json(results)
  } catch (err) {
    console.error('[search] error', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
