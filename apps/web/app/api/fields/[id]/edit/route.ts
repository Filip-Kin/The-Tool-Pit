import { type NextRequest, NextResponse } from 'next/server'
import { getIpHash } from '@/lib/utils/ip'
import { getCurrentUser } from '@/lib/auth/session'
import { checkSubmissionRateLimit } from '@/lib/rate-limit'
import { createFieldEditProposal } from '@/lib/fields/create-edit'
import { formStr as str, formNum as num, formBool as bool, formStringArray as strArr, readPhotoFiles, readMultipartForm } from '@/lib/fields/form-parse'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await readMultipartForm(req)
    if ('error' in body) return NextResponse.json({ error: body.error }, { status: body.status })
    const { form } = body

    const ipHash = getIpHash(req.headers.get('x-forwarded-for') ?? '')
    // Same rule as the submit route: suggesting an edit works signed out, the
    // account is attribution only.
    const user = await getCurrentUser()
    if (!(await checkSubmissionRateLimit('field-submit', ipHash))) {
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

    const parsed = await readPhotoFiles(form, 'photos')
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const result = await createFieldEditProposal(id, {
      name: str(form, 'name'),
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
      ceilingHeightFt: num(form, 'ceilingHeightFt'),
      availability: str(form, 'availability'),
      hours: str(form, 'hours'),
      contactInfo: str(form, 'contactInfo'),
      contactUrl: str(form, 'contactUrl'),
      website: str(form, 'website'),
      notes: str(form, 'notes'),
      note: str(form, 'editReason'),
      submitterName: str(form, 'submitterName'),
      submitterContact: str(form, 'submitterContact'),
      submitterIpHash: ipHash,
      submittedByUserId: user?.id ?? undefined,
      newPhotos: parsed.photos,
      removePhotoIds: strArr(form, 'removePhotoIds'),
    })

    if (result.status === 'error') return NextResponse.json({ error: result.message }, { status: 400 })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[fields/edit] error', err)
    return NextResponse.json({ error: 'Edit failed' }, { status: 500 })
  }
}
