import { type NextRequest, NextResponse } from 'next/server'
import { searchTools } from '@/lib/search/search'
import { recordSearchEvent } from '@/lib/analytics/events'
import { getIpHash } from '@/lib/utils/ip'
import { randomUUID } from 'crypto'

const SESSION_COOKIE = 'tp_sid'
const SESSION_MAX_AGE = 30 * 60 // 30 minutes

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const query = searchParams.get('q') ?? ''
  const program = searchParams.get('program') ?? undefined
  const page = parseInt(searchParams.get('page') ?? '1', 10)

  const existingSession = req.cookies.get(SESSION_COOKIE)?.value
  const sessionId = existingSession ?? randomUUID()

  try {
    const results = await searchTools({
      query,
      program: program as 'frc' | 'ftc' | 'fll' | undefined,
      page,
      pageSize: 20,
    })

    const ip = req.headers.get('x-forwarded-for') ?? ''
    recordSearchEvent({
      query,
      programFilter: program,
      resultCount: results.total,
      sessionId,
      ipHash: getIpHash(ip),
    }).catch(() => {})

    const response = NextResponse.json(results)
    if (!existingSession) {
      response.cookies.set(SESSION_COOKIE, sessionId, {
        maxAge: SESSION_MAX_AGE,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      })
    }
    return response
  } catch (err) {
    console.error('[search] error', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
