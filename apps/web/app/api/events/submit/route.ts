import { type NextRequest, NextResponse } from 'next/server'
import { getIpHash } from '@/lib/utils/ip'
import { getCurrentUser } from '@/lib/auth/session'
import { checkEventSubmissionRateLimit } from '@/lib/events/rate-limit'
import { createEventSubmission } from '@/lib/events/create-submission'
import { formStr as str, formNum as num, formBool as bool } from '@/lib/events/form-parse'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()

    const name = str(form, 'name')
    if (!name) return NextResponse.json({ error: 'An event name is required.' }, { status: 400 })

    const ipHash = getIpHash(req.headers.get('x-forwarded-for') ?? '')
    // Sign-in is optional on this route (same as fields): a signed-out
    // submission goes through on the IP hash alone, so this must never 401.
    const user = await getCurrentUser()
    if (!(await checkEventSubmissionRateLimit(ipHash))) {
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

    const result = await createEventSubmission({
      name,
      program: str(form, 'program'),
      hostTeamNumber: num(form, 'hostTeamNumber'),
      latitude: num(form, 'latitude'),
      longitude: num(form, 'longitude'),
      venueName: str(form, 'venueName'),
      address: str(form, 'address'),
      city: str(form, 'city'),
      region: str(form, 'region'),
      country: str(form, 'country'),
      startDate: str(form, 'startDate'),
      endDate: str(form, 'endDate'),
      days: num(form, 'days'),
      parallelDivisions: bool(form, 'parallelDivisions'),
      capacity: num(form, 'capacity'),
      costUsd: num(form, 'costUsd'),
      costNote: str(form, 'costNote'),
      registrationStatus: str(form, 'registrationStatus'),
      registrationOpensAt: str(form, 'registrationOpensAt'),
      volunteerStatus: str(form, 'volunteerStatus'),
      eventStatus: str(form, 'eventStatus'),
      website: str(form, 'website'),
      registrationUrl: str(form, 'registrationUrl'),
      volunteerUrl: str(form, 'volunteerUrl'),
      chiefDelphiUrl: str(form, 'chiefDelphiUrl'),
      contactEmail: str(form, 'contactEmail'),
      notes: str(form, 'notes'),
      submitterName: str(form, 'submitterName'),
      submitterContact: str(form, 'submitterContact'),
      submitterIpHash: ipHash,
      submittedByUserId: user?.id ?? undefined,
    })

    if (result.status === 'error') return NextResponse.json({ error: result.message }, { status: 400 })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[events/submit] error', err)
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 })
  }
}
