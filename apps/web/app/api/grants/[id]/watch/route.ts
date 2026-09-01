import { type NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { requireUser } from '@/lib/auth/session'
import { grantWatches, grants } from '@the-tool-pit/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Watch or unwatch one grant.
 *
 * A watch is the explicit "tell me about this one" subscription, independent of
 * matching: a team can watch a grant it does not yet qualify for, and it still
 * wants the deadline. The deadline sweeper reads grant_watches.remindDaysBefore
 * to decide when to remind.
 *
 * Every path returns JSON, including the signed-out one. This route is called
 * with fetch() from a button on the listing page, and a redirect to a sign-in
 * page arrives there as an opaque HTML body the button cannot act on. So: 401
 * with a code the client branches on to open the sign-in dialog. Same shape as
 * /api/favorites.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Bounds on the reminder offsets. A year is the furthest ahead a reminder makes
 * any sense, and six is more reminders than anybody wants about one grant. Both
 * are guards on a request body, not product opinions, and both are reported to
 * the caller rather than being trimmed silently.
 */
const MAX_OFFSET_DAYS = 365
const MAX_OFFSETS = 6

/** Matches grant_watches.remindDaysBefore's column default. */
const DEFAULT_REMIND_DAYS = [30, 14, 3]

function unauthenticated() {
  return NextResponse.json(
    { error: 'Sign in to watch a grant.', code: 'UNAUTHENTICATED' },
    { status: 401 },
  )
}

/**
 * The signed-in user, or null. Only requireUser's own UNAUTHENTICATED throw
 * becomes a 401; a database failure is rethrown, because answering "please sign
 * in" to a broken database sends people round a sign-in loop that cannot fix
 * anything.
 */
async function signedInUser() {
  try {
    return await requireUser()
  } catch (err) {
    if ((err as Error).message !== 'UNAUTHENTICATED') throw err
    return null
  }
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

/** Validate and tidy a caller-supplied offset list. */
function parseOffsets(raw: unknown): { ok: true; days: number[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'remindDaysBefore must be an array of whole days' }
  if (raw.length === 0) return { ok: false, error: 'Pick at least one reminder, or unwatch the grant.' }
  if (raw.length > MAX_OFFSETS) {
    return { ok: false, error: `You can have up to ${MAX_OFFSETS} reminders for one grant.` }
  }
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_OFFSET_DAYS) {
      return { ok: false, error: `Each reminder must be a whole number of days from 1 to ${MAX_OFFSET_DAYS}.` }
    }
  }
  // Deduped and largest first, which is the order the sweeper and the
  // preferences page both read them in.
  return { ok: true, days: [...new Set(raw as number[])].sort((a, b) => b - a) }
}

/**
 * POST /api/grants/<id>/watch
 * Body (optional): { remindDaysBefore?: number[], notifyOnChange?: boolean }
 *
 * Watching twice is not an error, it is a settings change: the unique index is
 * (userId, grantId), so a second POST updates the offsets in place.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await signedInUser()
  if (!user) return unauthenticated()

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Grant id must be a UUID' }, { status: 400 })

  const body = (await readJson(req)) as { remindDaysBefore?: unknown; notifyOnChange?: unknown } | null

  let remindDaysBefore = DEFAULT_REMIND_DAYS
  if (body?.remindDaysBefore !== undefined) {
    const parsed = parseOffsets(body.remindDaysBefore)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    remindDaysBefore = parsed.days
  }

  let notifyOnChange = true
  if (body?.notifyOnChange !== undefined) {
    if (typeof body.notifyOnChange !== 'boolean') {
      return NextResponse.json({ error: 'notifyOnChange must be true or false' }, { status: 400 })
    }
    notifyOnChange = body.notifyOnChange
  }

  const db = getDb()

  // Only published grants can be watched. A grant still pending review has no
  // public page and no human-confirmed dates, so a watch on it would promise a
  // reminder we have no business sending.
  const [grant] = await db
    .select({ id: grants.id, name: grants.name })
    .from(grants)
    .where(and(eq(grants.id, id), eq(grants.status, 'published')))
    .limit(1)

  if (!grant) {
    return NextResponse.json(
      { error: 'That grant does not exist or is not public.', code: 'TARGET_NOT_FOUND' },
      { status: 404 },
    )
  }

  const [row] = await db
    .insert(grantWatches)
    .values({ userId: user.id, grantId: grant.id, remindDaysBefore, notifyOnChange })
    .onConflictDoUpdate({
      target: [grantWatches.userId, grantWatches.grantId],
      set: { remindDaysBefore, notifyOnChange },
    })
    .returning()

  return NextResponse.json({
    watching: true,
    watch: {
      id: row.id,
      grantId: row.grantId,
      remindDaysBefore: row.remindDaysBefore,
      notifyOnChange: row.notifyOnChange,
    },
  })
}

/**
 * DELETE /api/grants/<id>/watch
 *
 * Unwatching something that was not watched returns 200 with watching:false.
 * The caller wanted it gone and it is gone, and a 404 here would make the
 * button flash an error on a double click.
 *
 * Reminders already queued for this grant are left alone on purpose. They are
 * rows in the outbox with a send time attached, and quietly retracting a
 * reminder somebody may be relying on is worse than one last email.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await signedInUser()
  if (!user) return unauthenticated()

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Grant id must be a UUID' }, { status: 400 })

  const db = getDb()
  const removed = await db
    .delete(grantWatches)
    .where(and(eq(grantWatches.userId, user.id), eq(grantWatches.grantId, id)))
    .returning({ id: grantWatches.id })

  return NextResponse.json({ watching: false, removed: removed.length })
}
