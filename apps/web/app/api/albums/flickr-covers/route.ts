import { type NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull, or, like } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albums } from '@the-tool-pit/db'

/**
 * Flickr cover backfill bridge. The cloud box is IP-blocked from Flickr, so a
 * NAS-side cron (residential IP) pulls the list of Flickr albums missing a cover
 * here (GET), scrapes each cover, and pushes them back (POST). Authenticated
 * with the admin secret - this is an internal, machine-to-machine endpoint.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET
  return Boolean(secret) && req.headers.get('x-admin-secret') === secret
}

/** Flickr-hosted albums (by provider or URL) that are published without a cover. */
const isFlickr = or(eq(albums.provider, 'flickr'), like(albums.url, '%flickr.com%'))

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = getDb()
  const rows = await db
    .select({ id: albums.id, url: albums.url })
    .from(albums)
    .where(and(eq(albums.status, 'published'), isNull(albums.coverImageUrl), isFlickr))
    .limit(500)
  return NextResponse.json({ albums: rows }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: { covers?: { id: string; coverImageUrl: string }[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const covers = body.covers ?? []
  const db = getDb()
  let updated = 0
  for (const c of covers) {
    if (!c.id || !c.coverImageUrl || !/^https?:\/\//.test(c.coverImageUrl)) continue
    // Only fill a cover that is still empty, which is the same condition the
    // GET above selects on. The two are minutes apart: the cron sleeps between
    // albums and works through up to 500 of them, and an owner who uploads a
    // cover inside that window had it replaced by a scraped Flickr URL, with
    // their uploaded image left orphaned in album_covers.
    const done = await db
      .update(albums)
      .set({ coverImageUrl: c.coverImageUrl, updatedAt: new Date() })
      .where(and(eq(albums.id, c.id), isNull(albums.coverImageUrl)))
      .returning({ id: albums.id })
    if (done.length === 0) continue
    updated++
  }
  return NextResponse.json({ updated })
}
