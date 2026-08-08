import { type NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { fieldEditProposalPhotos } from '@the-tool-pit/db'
import { isAdmin } from '@/lib/admin/auth'

/**
 * Serves a photo attached to a pending edit proposal, by photo id. Admin-only:
 * these images haven't been reviewed yet, so they're gated behind the moderator
 * session and shown only in the edit-proposal diff.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return new NextResponse('Forbidden', { status: 403 })
  const { id } = await params
  const db = getDb()
  const [row] = await db
    .select({ data: fieldEditProposalPhotos.data, contentType: fieldEditProposalPhotos.contentType })
    .from(fieldEditProposalPhotos)
    .where(eq(fieldEditProposalPhotos.id, id))
    .limit(1)
  if (!row) return new NextResponse('Not found', { status: 404 })

  const blob = new Blob([new Uint8Array(row.data)], { type: row.contentType })
  return new NextResponse(blob, {
    headers: {
      'Content-Type': row.contentType,
      'Cache-Control': 'private, max-age=60',
    },
  })
}
