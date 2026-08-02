'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albumCandidates } from '@the-tool-pit/db'
import { adminPublishAlbum } from '@/lib/admin/publish-album'
import { getEventByCode } from '@/lib/queries/albums'

async function assertAdmin() {
  const cookieStore = await cookies()
  const authed = cookieStore.get('admin_token')?.value === process.env.ADMIN_SECRET
  if (!authed) redirect('/admin/login')
}

export async function approveAlbumCandidate(candidateId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const result = await adminPublishAlbum(candidateId)
  revalidatePath('/admin/album-candidates')
  if ('error' in result) return { error: result.error }
  return {}
}

export async function suppressAlbumCandidate(candidateId: string, rejectionReason?: string): Promise<void> {
  await assertAdmin()
  const db = getDb()
  await db
    .update(albumCandidates)
    .set({ status: 'suppressed', rejectionReason: rejectionReason?.trim() || null, updatedAt: new Date() })
    .where(eq(albumCandidates.id, candidateId))
  revalidatePath('/admin/album-candidates')
}

/** Manually resolve the event for a candidate the pipeline couldn't match. */
export async function setAlbumEventMatch(candidateId: string, eventCode: string): Promise<{ error?: string }> {
  await assertAdmin()
  const code = eventCode.trim().toLowerCase()
  if (!code) return { error: 'Event code required' }
  const event = await getEventByCode(code)
  if (!event) return { error: `No event found for code "${code}"` }
  const db = getDb()
  await db
    .update(albumCandidates)
    .set({
      matchedEventId: event.id,
      status: 'matched',
      classification: { eventCode: code, method: 'none', reasoning: 'Admin-set' },
      updatedAt: new Date(),
    })
    .where(eq(albumCandidates.id, candidateId))
  revalidatePath('/admin/album-candidates')
  return {}
}
