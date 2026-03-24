import { type NextRequest, NextResponse } from 'next/server'
import { toggleVote } from '@/lib/voting/vote'
import { getVoterFingerprint } from '@/lib/voting/fingerprint'
import { checkVoteRateLimit } from '@/lib/voting/rate-limit'
import { getIpHash } from '@/lib/utils/ip'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { toolId } = body as { toolId: string }

    if (!toolId || typeof toolId !== 'string') {
      return NextResponse.json({ error: 'toolId required' }, { status: 400 })
    }

    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? ''
    const ipHash = getIpHash(ip)
    const fingerprint = getVoterFingerprint(req)

    // Rate-limit check: max 20 votes per minute per IP
    const allowed = await checkVoteRateLimit(ipHash)
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    const result = await toggleVote({ toolId, voterFingerprint: fingerprint, ipHash })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[vote] error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
