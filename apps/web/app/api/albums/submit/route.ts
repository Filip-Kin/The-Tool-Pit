import { type NextRequest, NextResponse } from 'next/server'
import { getIpHash } from '@/lib/utils/ip'
import { checkSubmissionRateLimit } from '@/lib/rate-limit'
import { createAlbumSubmission } from '@/lib/albums/create-submission'
import { getCurrentUser } from '@/lib/auth/session'
import { submitterOwnsFromForm } from '@/lib/listings/passing-along'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { url, eventHint, code, year, program, tbaKey, photographer, note, passingAlong, turnstileToken } = body as {
      url: string
      eventHint?: string
      code?: string
      year?: number
      program?: string
      tbaKey?: string
      photographer?: string
      note?: string
      /** "This album is not mine". Absent falls back to the vertical default. */
      passingAlong?: boolean
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
    if (!(await checkSubmissionRateLimit('album-submit', ipHash))) {
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

    // Sign-in is OPTIONAL on this route and must never turn into a 401. A
    // signed-out submission still goes through on the IP hash alone; an account
    // only buys attribution and an email when a moderator gets to it.
    const user = await getCurrentUser()

    const result = await createAlbumSubmission({
      url,
      submittedByUserId: user?.id ?? undefined,
      submitterOwns: submitterOwnsFromForm(passingAlong, 'album', Boolean(user)),
      eventHint,
      code,
      year: typeof year === 'number' && Number.isInteger(year) ? year : undefined,
      program: program === 'ftc' ? 'ftc' : program === 'frc' ? 'frc' : undefined,
      tbaKey,
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
