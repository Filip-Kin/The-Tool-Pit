import { type NextRequest, NextResponse } from 'next/server'
import { recordClickEvent } from '@/lib/analytics/events'
import { getIpHash } from '@/lib/utils/ip'
import { getDb } from '@/lib/db'
import { tools } from '@the-tool-pit/db'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { toolId, linkType } = body as { toolId: string; linkType: string }

    if (!toolId || !linkType) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    // Verify the tool exists before recording a click event
    const db = getDb()
    const [tool] = await db.select({ id: tools.id }).from(tools).where(eq(tools.id, toolId)).limit(1)
    if (!tool) {
      return NextResponse.json({ ok: false }, { status: 404 })
    }

    const ip = req.headers.get('x-forwarded-for') ?? ''
    recordClickEvent({ toolId, linkType, ipHash: getIpHash(ip) }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
