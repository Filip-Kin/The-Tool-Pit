import { type NextRequest, NextResponse } from 'next/server'
import { createSubmission } from '@/lib/submissions/create'
import { getIpHash } from '@/lib/utils/ip'
import { checkSubmissionRateLimit } from '@/lib/submissions/rate-limit'
import { getCurrentUser } from '@/lib/auth/session'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { url, note, turnstileToken } = body as { url: string; note?: string; turnstileToken?: string }

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

    // Validate Turnstile CAPTCHA when secret key is configured
    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY
    if (turnstileSecret) {
      if (!turnstileToken) {
        return NextResponse.json({ error: 'CAPTCHA required' }, { status: 400 })
      }
      const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: turnstileSecret, response: turnstileToken }),
      })
      const cfResult = await verification.json() as { success: boolean }
      if (!cfResult.success) {
        return NextResponse.json({ error: 'CAPTCHA verification failed. Please try again.' }, { status: 400 })
      }
    }

    // Sign-in is OPTIONAL on this route and must never turn into a 401. A
    // signed-out submission still goes through on the IP hash alone; an account
    // only buys attribution and an email when a moderator gets to it.
    const user = await getCurrentUser()

    const result = await createSubmission({
      url,
      note,
      submitterIpHash: ipHash,
      submittedByUserId: user?.id ?? undefined,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[submit] error', err)
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 })
  }
}
