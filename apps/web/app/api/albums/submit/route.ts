import { type NextRequest, NextResponse } from 'next/server'
import { getIpHash } from '@/lib/utils/ip'
import { checkAlbumSubmissionRateLimit } from '@/lib/albums/rate-limit'
import { createAlbumSubmission } from '@/lib/albums/create-submission'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { url, eventHint, year, photographer, note, turnstileToken } = body as {
      url: string
      eventHint?: string
      year?: number
      photographer?: string
      note?: string
      turnstileToken?: string
    }

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url required' }, { status: 400 })
    }
    try {
      new URL(url)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    const ipHash = getIpHash(req.headers.get('x-forwarded-for') ?? '')
    if (!(await checkAlbumSubmissionRateLimit(ipHash))) {
      return NextResponse.json({ error: 'Too many submissions. Please wait.' }, { status: 429 })
    }

    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY
    if (turnstileSecret) {
      const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: turnstileSecret, response: turnstileToken ?? '' }),
      })
      const outcome = (await verify.json()) as { success: boolean }
      if (!outcome.success) {
        return NextResponse.json({ error: 'Verification failed' }, { status: 400 })
      }
    }

    const result = await createAlbumSubmission({
      url,
      eventHint,
      year: typeof year === 'number' && Number.isInteger(year) ? year : undefined,
      photographerHint: photographer,
      note,
      submitterIpHash: ipHash,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[albums/submit] error', err)
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 })
  }
}
