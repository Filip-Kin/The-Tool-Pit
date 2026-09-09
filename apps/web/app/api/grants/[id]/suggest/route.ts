import { type NextRequest, NextResponse } from 'next/server'
import { getIpHash } from '@/lib/utils/ip'
import { getCurrentUser } from '@/lib/auth/session'
import { checkSubmissionRateLimit } from '@/lib/rate-limit'
import { createGrantEditSuggestion } from '@/lib/grants/suggest-edit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * "Suggest an edit" on a grant. Same shape as the event edit route: works
 * signed out (the account is attribution only), rate limited per address,
 * and everything lands in the change queue for a human.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const form = await req.formData()
  const ipHash = getIpHash(req.headers.get('x-forwarded-for') ?? '')
  if (!(await checkSubmissionRateLimit('grant-suggest', ipHash))) {
    return NextResponse.json({ error: 'Too many suggestions. Please wait a bit.' }, { status: 429 })
  }
  const user = await getCurrentUser()
  // Every field the page shows can be suggested; the handler decides what counts.
  const values: Record<string, string | undefined> = {}
  for (const [k, v] of form.entries()) if (typeof v === 'string' && v.trim() && /^[a-zA-Z]+$/.test(k)) values[k] = v.trim()
  const result = await createGrantEditSuggestion(id, {
    fields: values,
    evidenceUrl: values.evidenceUrl ?? '',
    ipHash,
    userId: user?.id ?? null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, filed: result.filed })
}
