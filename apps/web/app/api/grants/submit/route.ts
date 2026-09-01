import { type NextRequest, NextResponse } from 'next/server'
import { getIpHash } from '@/lib/utils/ip'
// The FormData getters are vertical-neutral despite living under lib/fields.
// Copying them here would be two implementations of trim-and-drop-empties.
import { formStr as str } from '@/lib/fields/form-parse'
import { checkSubmissionRateLimit } from '@/lib/rate-limit'
import { createGrantSubmission } from '@/lib/grants/create-submission'
import { getCurrentUser } from '@/lib/auth/session'
import { submitterOwnsFromForm } from '@/lib/listings/passing-along'

/**
 * Public grant submission. No account required, same shape as the fields
 * submit route: IP-hash rate limit, then Turnstile, then the write.
 *
 * Nothing this route accepts is published. It writes a pending candidate for a
 * human to review, so it can afford to be generous about what it takes in.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()

    const name = str(form, 'name')
    const infoUrl = str(form, 'infoUrl')
    if (!name) return NextResponse.json({ error: 'A grant name is required.' }, { status: 400 })
    if (!infoUrl) return NextResponse.json({ error: 'A link to the funder page is required.' }, { status: 400 })

    const ipHash = getIpHash(req.headers.get('x-forwarded-for') ?? '')
    if (!(await checkSubmissionRateLimit('grant-submit', ipHash))) {
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

    const result = await createGrantSubmission({
      name,
      submittedByUserId: user?.id ?? undefined,
      submitterOwns: submitterOwnsFromForm(str(form, 'passingAlong'), 'grant', Boolean(user)),
      infoUrl,
      funderName: str(form, 'funderName'),
      applicationUrl: str(form, 'applicationUrl'),
      summary: str(form, 'summary'),
      notes: str(form, 'notes'),
      submitterName: str(form, 'submitterName'),
      submitterContact: str(form, 'submitterContact'),
      submitterIpHash: ipHash,
    })

    if (result.status === 'error') return NextResponse.json({ error: result.message }, { status: 400 })
    // A duplicate is a 200 with an explanation, not an error. The person did
    // nothing wrong, and a red box for "we already have it" reads as a failure.
    return NextResponse.json(result)
  } catch (err) {
    console.error('[grants/submit] error', err)
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 })
  }
}
