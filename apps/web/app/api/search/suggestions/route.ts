import { type NextRequest, NextResponse } from 'next/server'
import { searchTools } from '@/lib/search/search'

/**
 * Lightweight suggestions endpoint — returns top 5 matching tools for the
 * search bar dropdown. No analytics logging (not a committed search).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const query = searchParams.get('q') ?? ''
  const program = searchParams.get('program') ?? undefined

  if (!query.trim()) {
    return NextResponse.json([])
  }

  try {
    const results = await searchTools({
      query,
      program: program as 'frc' | 'ftc' | 'fll' | undefined,
      page: 1,
      pageSize: 5,
    })

    const suggestions = results.tools.map((t) => ({
      name: t.name,
      slug: t.slug,
      summary: t.summary,
    }))

    return NextResponse.json(suggestions, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json([])
  }
}
