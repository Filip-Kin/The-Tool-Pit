import { type NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { fieldPhotos } from '@the-tool-pit/db'

/**
 * Serves an uploaded practice-field photo from the DB, by photo id. Only bytes
 * are exposed - no moderation state - so unpublished fields' photos aren't
 * linked anywhere public until an admin publishes them.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const [row] = await db
    .select({ data: fieldPhotos.data, contentType: fieldPhotos.contentType })
    .from(fieldPhotos)
    .where(eq(fieldPhotos.id, id))
    .limit(1)
  if (!row) return new NextResponse('Not found', { status: 404 })

  const blob = new Blob([new Uint8Array(row.data)], { type: row.contentType })
  return new NextResponse(blob, {
    headers: {
      'Content-Type': row.contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
