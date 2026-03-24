import { type NextRequest, NextResponse } from 'next/server'
import { recordClickEvent } from '@/lib/analytics/events'
import { getIpHash } from '@/lib/utils/ip'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { toolId, linkType } = body as { toolId: string; linkType: string }

    if (!toolId || !linkType) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    const ip = req.headers.get('x-forwarded-for') ?? ''
    recordClickEvent({ toolId, linkType, ipHash: getIpHash(ip) }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
