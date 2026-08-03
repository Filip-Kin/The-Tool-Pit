import { type NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albumCovers } from '@the-tool-pit/db'

/**
 * Serves a manually-uploaded album cover from the DB. The album's
 * cover_image_url points here (with a ?v= cache-buster set at upload time).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  const [row] = await db
    .select({ data: albumCovers.data, contentType: albumCovers.contentType })
    .from(albumCovers)
    .where(eq(albumCovers.albumId, id))
    .limit(1)
  if (!row) return new NextResponse('Not found', { status: 404 })

  // Wrap in a Blob so the body is a plain BodyInit regardless of Buffer typing.
  const blob = new Blob([new Uint8Array(row.data)], { type: row.contentType })
  return new NextResponse(blob, {
    headers: {
      'Content-Type': row.contentType,
      // The URL carries a version query, so the bytes at a given URL are stable.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
