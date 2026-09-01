import { type NextRequest, NextResponse } from 'next/server'
import { getIpHash } from '@/lib/utils/ip'
// The FormData getters are vertical-neutral despite living under lib/fields.
import { formStr as str, formNum as num } from '@/lib/fields/form-parse'
import { checkRobotCodeSubmissionRateLimit } from '@/lib/robot-code/rate-limit'
import { createRobotCodeSubmission } from '@/lib/robot-code/create-submission'
import { getCurrentUser } from '@/lib/auth/session'

/**
 * Public robot code / CAD submission. No account required, same shape as the
 * fields and grants submit routes: IP-hash rate limit, then Turnstile, then the
 * write. Sign-in must never be a wall in front of a team adding their own work.
 *
 * Field-level validation lives in createRobotCodeSubmission rather than here,
 * so the route and any future caller cannot disagree about what a valid team
 * number is.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()

    const url = str(form, 'url')
    if (!url) return NextResponse.json({ error: 'A link is required.' }, { status: 400 })

    const ipHash = getIpHash(req.headers.get('x-forwarded-for') ?? '')
    if (!(await checkRobotCodeSubmissionRateLimit(ipHash))) {
      return NextResponse.json({ error: 'Too many submissions. Please wait.' }, { status: 429 })
    }

    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY
    if (turnstileSecret) {
      const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: turnstileSecret, response: str(form, 'turnstileToken') ?? '' }),
      })
      const outcome = (await verify.json()) as { success: boolean }
      if (!outcome.success) return NextResponse.json({ error: 'Verification failed' }, { status: 400 })
    }

    // Sign-in is OPTIONAL on this route and must never turn into a 401. A
    // signed-out submission still goes through on the IP hash alone; an account
    // only buys attribution and an email when a moderator gets to it.
    const user = await getCurrentUser()

    const result = await createRobotCodeSubmission({
      url,
      submittedByUserId: user?.id ?? undefined,
      program: str(form, 'program') ?? '',
      teamNumber: num(form, 'teamNumber') ?? NaN,
      seasonYear: num(form, 'seasonYear') ?? NaN,
      artifactKind: str(form, 'artifactKind') ?? '',
      note: str(form, 'note'),
      submitterIpHash: ipHash,
    })

    if (result.status === 'error') return NextResponse.json({ error: result.message }, { status: 400 })
    // A duplicate is a 200 with an explanation, not an error. The person did
    // nothing wrong, and a red box for "we already have it" reads as a failure.
    return NextResponse.json(result)
  } catch (err) {
    console.error('[robot-code/submit] error', err)
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 })
  }
}
