'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq, or, desc } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albumCandidates, events } from '@the-tool-pit/db'
import { adminPublishAlbum } from '@/lib/admin/publish-album'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
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

/**
 * Manually resolve the event for a candidate the pipeline couldn't match.
 * Accepts either the short event code ("micmp") or the full TBA key ("2026micmp").
 */
export async function setAlbumEventMatch(candidateId: string, eventCode: string): Promise<{ error?: string }> {
  await assertAdmin()
  const raw = eventCode.trim().toLowerCase()
  if (!raw) return { error: 'Event code required' }
  const codeOnly = raw.replace(/^\d{4}/, '') // strip a leading year if a full TBA key was given
  const db = getDb()
  const [event] = await db
    .select()
    .from(events)
    .where(or(eq(events.tbaKey, raw), eq(events.eventCode, codeOnly)))
    .orderBy(desc(events.year))
    .limit(1)
  if (!event) return { error: `No event found for "${eventCode}"` }
  await db
    .update(albumCandidates)
    .set({
      matchedEventId: event.id,
      status: 'matched',
      classification: { eventCode: event.eventCode, method: 'none', reasoning: 'Admin-set' },
      updatedAt: new Date(),
    })
    .where(eq(albumCandidates.id, candidateId))
  revalidatePath('/admin/album-candidates')
  return {}
}
