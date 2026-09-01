import { type NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/session'
import {
  addFavorite,
  favoriteTargetExists,
  getFavoritesForUser,
  isFavoriteEntityType,
  removeFavorite,
} from '@/lib/queries/favorites'
import type { FavoriteEntityType } from '@the-tool-pit/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Favourites API, shared by all four verticals.
 *
 * Every path returns JSON, including the unauthenticated one. Server
 * components can let requireUser() throw, but this route is called with
 * fetch() from card components, where a redirect to a sign-in page arrives as
 * an opaque HTML body the button cannot act on. So: 401 with a code the client
 * branches on to open the sign-in dialog.
 */

/** Longest note we store. Room for a real reminder, still short enough to render on a card. */
const MAX_NOTE_LENGTH = 500

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function unauthenticated() {
  return NextResponse.json(
    { error: 'Sign in to save things.', code: 'UNAUTHENTICATED' },
    { status: 401 },
  )
}

/**
 * The signed-in user, or null when there is no session.
 *
 * Only requireUser's own UNAUTHENTICATED throw becomes a 401. Anything else
 * (a database failure while loading the user row) is rethrown, because
 * answering "please sign in" to a broken database sends people round a
 * sign-in loop that cannot fix anything.
 */
async function signedInUser() {
  try {
    return await requireUser()
  } catch (err) {
    if ((err as Error).message !== 'UNAUTHENTICATED') throw err
    return null
  }
}

/**
 * Shared body validation for POST and DELETE. Rejects an unknown entityType
 * (400) rather than storing it, because a favourite the read layer cannot
 * resolve is invisible in the list and so cannot be removed from the UI.
 */
function parseTarget(body: unknown):
  | { ok: true; entityType: FavoriteEntityType; entityId: string }
  | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'JSON object body required' }
  }
  const { entityType, entityId } = body as { entityType?: unknown; entityId?: unknown }

  if (!isFavoriteEntityType(entityType)) {
    return { ok: false, error: 'entityType must be one of tool, album, event, field, grant' }
  }
  if (typeof entityId !== 'string' || !UUID_RE.test(entityId)) {
    return { ok: false, error: 'entityId must be a UUID' }
  }
  return { ok: true, entityType, entityId }
}

/** The request body as an object, or null when it is absent or not JSON. */
async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

/**
 * GET /api/favorites[?type=tool]
 *
 * Resolved, display-ready items with dangling targets already dropped, so the
 * caller never has to know which vertical a favourite came from.
 */
export async function GET(req: NextRequest) {
  const user = await signedInUser()
  if (!user) return unauthenticated()

  const type = req.nextUrl.searchParams.get('type')
  if (type !== null && !isFavoriteEntityType(type)) {
    return NextResponse.json({ error: `Unknown type '${type}'` }, { status: 400 })
  }

  const items = await getFavoritesForUser(user.id, { entityType: type ?? undefined })
  return NextResponse.json({ favorites: items })
}

/** POST { entityType, entityId, note? } - save. Saving twice is a no-op, not an error. */
export async function POST(req: NextRequest) {
  const user = await signedInUser()
  if (!user) return unauthenticated()

  const body = await readJson(req)
  const parsed = parseTarget(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // `undefined` and `null` mean different things downstream: undefined leaves
  // any existing note alone, null clears it.
  const rawNote = (body as { note?: unknown }).note
  let note: string | null | undefined
  if (rawNote === null) {
    note = null
  } else if (typeof rawNote === 'string') {
    note = rawNote.trim() || null
    if (note && note.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { error: `note must be ${MAX_NOTE_LENGTH} characters or fewer` },
        { status: 400 },
      )
    }
  } else if (rawNote !== undefined) {
    return NextResponse.json({ error: 'note must be a string' }, { status: 400 })
  }

  // Check the target before writing so the table cannot fill with rows pointing
  // at a deleted or unpublished thing, which the read path would then silently
  // hide and the user could never clear.
  if (!(await favoriteTargetExists(parsed.entityType, parsed.entityId))) {
    return NextResponse.json(
      { error: 'That item does not exist or is not public.', code: 'TARGET_NOT_FOUND' },
      { status: 404 },
    )
  }

  const row = await addFavorite(user.id, parsed.entityType, parsed.entityId, note)
  return NextResponse.json({
    favorited: true,
    favorite: { id: row.id, entityType: row.entityType, entityId: row.entityId, note: row.note },
  })
}

/**
 * DELETE { entityType, entityId } - unsave.
 *
 * Removing something that was not saved returns 200 with favorited:false. The
 * caller wanted it gone and it is gone, and a 404 here would make the button
 * flash an error on a double click.
 */
export async function DELETE(req: NextRequest) {
  const user = await signedInUser()
  if (!user) return unauthenticated()

  // Body first, query string as a fallback: fetch() can send a body on DELETE,
  // but not every caller can (sendBeacon cannot, and some proxies drop it).
  let body = await readJson(req)
  if (body === null) {
    body = {
      entityType: req.nextUrl.searchParams.get('entityType') ?? undefined,
      entityId: req.nextUrl.searchParams.get('entityId') ?? undefined,
    }
  }

  const parsed = parseTarget(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const removed = await removeFavorite(user.id, parsed.entityType, parsed.entityId)
  return NextResponse.json({ favorited: false, removed })
}
