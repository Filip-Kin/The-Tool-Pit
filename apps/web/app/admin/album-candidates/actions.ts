'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
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
  // Refresh the public pages so the new album shows without a manual reload.
  revalidatePath('/photos')
  if (result.tbaKey) revalidatePath(`/photos/event/${result.tbaKey}`)
  if (result.eventCode) revalidatePath(`/photos/event/${result.eventCode}`)
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
export async function setAlbumEventMatch(candidateId: string, eventKey: string): Promise<{ error?: string }> {
  await assertAdmin()
  const raw = eventKey.trim().toLowerCase()
  // The year is mandatory: only a full TBA key (year + code, e.g. "2023txbel") is
  // accepted. A bare code is rejected so an album can never get the wrong year.
  if (!/^(19|20)\d{2}[a-z0-9]+$/.test(raw)) {
    return { error: 'Enter the full event key including the year, e.g. 2023txbel' }
  }
  const db = getDb()
  const [event] = await db.select().from(events).where(eq(events.tbaKey, raw)).limit(1)
  if (!event) return { error: `No event found for "${eventKey}"` }
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
