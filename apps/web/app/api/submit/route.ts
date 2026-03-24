import { type NextRequest, NextResponse } from 'next/server'
import { createSubmission } from '@/lib/submissions/create'
import { getIpHash } from '@/lib/utils/ip'
import { checkSubmissionRateLimit } from '@/lib/submissions/rate-limit'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { url, note } = body as { url: string; note?: string }

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url required' }, { status: 400 })
    }

    // Validate URL format
    try {
      new URL(url)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    const ip = req.headers.get('x-forwarded-for') ?? ''
    const ipHash = getIpHash(ip)

    const allowed = await checkSubmissionRateLimit(ipHash)
    if (!allowed) {
      return NextResponse.json({ error: 'Too many submissions. Please wait.' }, { status: 429 })
    }

    const result = await createSubmission({ url, note, submitterIpHash: ipHash })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[submit] error', err)
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 })
  }
}
