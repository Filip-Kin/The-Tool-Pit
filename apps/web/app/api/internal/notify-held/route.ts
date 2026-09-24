import { NextResponse } from 'next/server'
import { authorised } from '@/lib/internal-auth'
import { notifyToolSubmissionHeld } from '@/lib/submissions/notify-held'

/**
 * POST /api/internal/notify-held  { submissionId, hold? }
 *
 * The worker's way of saying "this tool submission needs a person". Same
 * shared secret as /api/internal/moderate. The post is made here because only
 * the web app records which Discord message is about which row, which is what
 * makes a ✅ on it publish.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<NextResponse> {
  if (!authorised(req)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as { submissionId?: unknown; hold?: unknown } | null
  const submissionId = typeof body?.submissionId === 'string' ? body.submissionId.trim() : ''
  if (!submissionId) return NextResponse.json({ error: 'submissionId is required.' }, { status: 400 })
  const hold = typeof body?.hold === 'string' && body.hold.trim() ? body.hold.trim().slice(0, 200) : null
  const out = await notifyToolSubmissionHeld(submissionId, hold)
  if (out.error) return NextResponse.json(out, { status: 404 })
  return NextResponse.json({ ok: true })
}
