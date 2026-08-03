'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albumCandidates, albums, albumSources, events } from '@the-tool-pit/db'
import type { AlbumCandidateMetadata } from '@the-tool-pit/db'
import { adminPublishAlbum } from '@/lib/admin/publish-album'
import { fetchOgImage } from '@/lib/albums/og'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

/**
 * Load a published candidate's live album + its event key (for revalidation).
 * Returns an error string if the candidate isn't a published album.
 */
async function loadPublishedAlbum(candidateId: string) {
  const db = getDb()
  const [cand] = await db
    .select({
      status: albumCandidates.status,
      matchedAlbumId: albumCandidates.matchedAlbumId,
      rawMetadata: albumCandidates.rawMetadata,
    })
    .from(albumCandidates)
    .where(eq(albumCandidates.id, candidateId))
    .limit(1)
  if (!cand) return { error: 'Candidate not found' as const }
  if (!cand.matchedAlbumId) return { error: 'This candidate has no published album.' as const }

  const [album] = await db
    .select({ id: albums.id, url: albums.url, canonicalUrl: albums.canonicalUrl, eventId: albums.eventId })
    .from(albums)
    .where(eq(albums.id, cand.matchedAlbumId))
    .limit(1)
  if (!album) return { error: 'Published album not found.' as const }

  const [ev] = await db.select({ tbaKey: events.tbaKey }).from(events).where(eq(events.id, album.eventId)).limit(1)
  return { db, cand, album, tbaKey: ev?.tbaKey }
}

/** Edit the title of a published album (and remember it on the candidate). */
export async function renameAlbumTitle(candidateId: string, title: string): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = title.trim()
  if (!clean) return { error: 'Title cannot be empty.' }
  const loaded = await loadPublishedAlbum(candidateId)
  if ('error' in loaded) return loaded
  const { db, cand, album, tbaKey } = loaded

  await db.update(albums).set({ title: clean, updatedAt: new Date() }).where(eq(albums.id, album.id))
  const meta = (cand.rawMetadata ?? {}) as AlbumCandidateMetadata
  await db
    .update(albumCandidates)
    .set({ rawMetadata: { ...meta, title: clean }, updatedAt: new Date() })
    .where(eq(albumCandidates.id, candidateId))

  revalidatePath('/admin/album-candidates')
  revalidatePath('/photos')
  if (tbaKey) revalidatePath(`/photos/event/${tbaKey}`)
  return {}
}

/** Re-scrape the album host for a fresh Open Graph cover image. */
export async function refetchAlbumCover(candidateId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const loaded = await loadPublishedAlbum(candidateId)
  if ('error' in loaded) return loaded
  const { db, cand, album, tbaKey } = loaded

  const image = await fetchOgImage(album.canonicalUrl ?? album.url)
  if (!image) return { error: 'Could not find a cover image on the album host.' }

  await db.update(albums).set({ coverImageUrl: image, updatedAt: new Date() }).where(eq(albums.id, album.id))
  const meta = (cand.rawMetadata ?? {}) as AlbumCandidateMetadata
  await db
    .update(albumCandidates)
    .set({ rawMetadata: { ...meta, coverImageUrl: image }, updatedAt: new Date() })
    .where(eq(albumCandidates.id, candidateId))

  revalidatePath('/admin/album-candidates')
  revalidatePath('/photos')
  if (tbaKey) revalidatePath(`/photos/event/${tbaKey}`)
  return {}
}

/**
 * Remove a published album. Deletes the album + its source evidence and returns
 * the candidate to 'suppressed' (it keeps its event match, so it can be
 * re-approved later if the removal was a mistake).
 */
export async function deletePublishedAlbum(candidateId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const loaded = await loadPublishedAlbum(candidateId)
  if ('error' in loaded) return loaded
  const { db, album, tbaKey } = loaded

  await db
    .update(albumCandidates)
    .set({ status: 'suppressed', matchedAlbumId: null, updatedAt: new Date() })
    .where(eq(albumCandidates.id, candidateId))
  await db.delete(albumSources).where(eq(albumSources.albumId, album.id))
  await db.delete(albums).where(eq(albums.id, album.id))

  revalidatePath('/admin/album-candidates')
  revalidatePath('/photos')
  if (tbaKey) revalidatePath(`/photos/event/${tbaKey}`)
  return {}
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
 * Set or change the event for a candidate by its full TBA key (year + code).
 * Works for pending, matched, AND published candidates - for a published one it
 * also repoints the live album and refreshes the affected event pages.
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
  if (event.startDate && new Date(event.startDate) > new Date()) {
    return { error: 'That event has not happened yet.' }
  }

  const [cand] = await db
    .select({ status: albumCandidates.status, matchedAlbumId: albumCandidates.matchedAlbumId, matchedEventId: albumCandidates.matchedEventId })
    .from(albumCandidates)
    .where(eq(albumCandidates.id, candidateId))
    .limit(1)
  if (!cand) return { error: 'Candidate not found' }

  // Old event key (for revalidating the page the album is leaving).
  let oldKey: string | undefined
  if (cand.matchedEventId) {
    const [oldEv] = await db.select({ tbaKey: events.tbaKey }).from(events).where(eq(events.id, cand.matchedEventId)).limit(1)
    oldKey = oldEv?.tbaKey
  }

  await db
    .update(albumCandidates)
    .set({
      matchedEventId: event.id,
      status: cand.status === 'published' ? 'published' : 'matched',
      classification: { eventCode: event.eventCode, method: 'none', reasoning: 'Admin-set' },
      updatedAt: new Date(),
    })
    .where(eq(albumCandidates.id, candidateId))

  // If it's already published, repoint the live album and refresh both pages.
  if (cand.matchedAlbumId) {
    await db.update(albums).set({ eventId: event.id, updatedAt: new Date() }).where(eq(albums.id, cand.matchedAlbumId))
    revalidatePath('/photos')
    revalidatePath(`/photos/event/${event.tbaKey}`)
    if (oldKey && oldKey !== event.tbaKey) revalidatePath(`/photos/event/${oldKey}`)
  }

  revalidatePath('/admin/album-candidates')
  return {}
}
