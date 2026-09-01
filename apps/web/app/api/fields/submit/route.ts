import { type NextRequest, NextResponse } from 'next/server'
import { getIpHash } from '@/lib/utils/ip'
import { getCurrentUser } from '@/lib/auth/session'
import { submitterOwnsFromForm } from '@/lib/listings/passing-along'
import { checkFieldSubmissionRateLimit } from '@/lib/fields/rate-limit'
import { createFieldSubmission } from '@/lib/fields/create-submission'
import { formStr as str, formNum as num, formBool as bool, readPhotoFiles } from '@/lib/fields/form-parse'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()

    const name = str(form, 'name')
    if (!name) return NextResponse.json({ error: 'A field name is required.' }, { status: 400 })

    const ipHash = getIpHash(req.headers.get('x-forwarded-for') ?? '')
    // Sign-in is optional on this route. A signed-out submission still goes
    // through on the IP hash alone, an account only adds attribution, so this
    // must never turn into a 401.
    const user = await getCurrentUser()
    if (!(await checkFieldSubmissionRateLimit(ipHash))) {
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

    // Optional photos.
    const parsed = await readPhotoFiles(form, 'photos')
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const result = await createFieldSubmission({
      name,
      teamNumber: num(form, 'teamNumber'),
      teamName: str(form, 'teamName'),
      program: str(form, 'program'),
      latitude: num(form, 'latitude'),
      longitude: num(form, 'longitude'),
      address: str(form, 'address'),
      city: str(form, 'city'),
      region: str(form, 'region'),
      country: str(form, 'country'),
      coverage: str(form, 'coverage'),
      perimeter: str(form, 'perimeter'),
      elements: str(form, 'elements'),
      hasFms: bool(form, 'hasFms'),
      aprilTags: bool(form, 'aprilTags'),
      ceilingHeightFt: num(form, 'ceilingHeightFt'),
      availability: str(form, 'availability'),
      hours: str(form, 'hours'),
      contactInfo: str(form, 'contactInfo'),
      contactUrl: str(form, 'contactUrl'),
      website: str(form, 'website'),
      notes: str(form, 'notes'),
      submitterName: str(form, 'submitterName'),
      submitterContact: str(form, 'submitterContact'),
      submitterIpHash: ipHash,
      submittedByUserId: user?.id ?? undefined,
      submitterOwns: submitterOwnsFromForm(str(form, 'passingAlong'), 'field', Boolean(user)),
      photos: parsed.photos,
    })

    if (result.status === 'error') return NextResponse.json({ error: result.message }, { status: 400 })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[fields/submit] error', err)
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 })
  }
}
