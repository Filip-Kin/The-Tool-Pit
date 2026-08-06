import { type NextRequest, NextResponse } from 'next/server'
import { getIpHash } from '@/lib/utils/ip'
import { checkFieldSubmissionRateLimit } from '@/lib/fields/rate-limit'
import { createFieldSubmission } from '@/lib/fields/create-submission'

const MAX_PHOTO_BYTES = 10 * 1024 * 1024

function str(form: FormData, key: string): string | undefined {
  const v = form.get(key)
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}
function num(form: FormData, key: string): number | undefined {
  const v = str(form, key)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
function bool(form: FormData, key: string): boolean {
  const v = form.get(key)
  return v === 'true' || v === 'on' || v === '1'
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()

    const name = str(form, 'name')
    if (!name) return NextResponse.json({ error: 'A field name is required.' }, { status: 400 })

    const ipHash = getIpHash(req.headers.get('x-forwarded-for') ?? '')
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

    // Optional photo.
    let photo: { data: Buffer; contentType: string } | undefined
    const file = form.get('photo')
    if (file instanceof File && file.size > 0) {
      if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'The photo must be an image.' }, { status: 400 })
      if (file.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: 'Photo is larger than 10 MB.' }, { status: 400 })
      photo = { data: Buffer.from(await file.arrayBuffer()), contentType: file.type }
    }

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
      photo,
    })

    if (result.status === 'error') return NextResponse.json({ error: result.message }, { status: 400 })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[fields/submit] error', err)
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 })
  }
}
