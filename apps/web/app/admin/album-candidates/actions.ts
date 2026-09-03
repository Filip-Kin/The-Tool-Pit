'use server'

import { isAdmin } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albumCandidates, albums, albumSources, albumCovers, events } from '@the-tool-pit/db'
import type { AlbumCandidateMetadata } from '@the-tool-pit/db'
import { adminPublishAlbum } from '@/lib/admin/publish-album'
import { fetchOgImage } from '@/lib/albums/og'
import { notifyAlbumPublished, notifyAlbumCandidateRejected } from '@/lib/notify/approvals'
import { grantAlbumOwnership } from '@/lib/listings/submitter-ownership'
import { normaliseUploadedImage } from '@/lib/images/normalise'

async function assertAdmin() {
  if (!(await isAdmin())) redirect('/admin/login')
}

const CMP_DIVISION_TYPES = new Set([3, 5])

/**
 * Bust the public caches an album on this event affects: the home feed, the
 * event's own page, and - if the event is a championship division - the parent
 * championship page, since the division's albums are rolled up and shown there.
 */
async function revalidateEventPublic(eventId: string | null | undefined) {
  revalidatePath('/photos')
  if (!eventId) return
  const db = getDb()
  const [ev] = await db
    .select({ tbaKey: events.tbaKey, eventCode: events.eventCode, year: events.year, eventType: events.eventType })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1)
  if (!ev) return
  revalidatePath(`/photos/event/${ev.tbaKey}`)
  if (CMP_DIVISION_TYPES.has(ev.eventType ?? -1) && /\d$/.test(ev.eventCode)) {
    revalidatePath(`/photos/event/${ev.year}${ev.eventCode.replace(/\d+$/, '')}`)
  }
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
  const { db, cand, album } = loaded

  await db.update(albums).set({ title: clean, updatedAt: new Date() }).where(eq(albums.id, album.id))
  const meta = (cand.rawMetadata ?? {}) as AlbumCandidateMetadata
  await db
    .update(albumCandidates)
    .set({ rawMetadata: { ...meta, title: clean }, updatedAt: new Date() })
    .where(eq(albumCandidates.id, candidateId))

  revalidatePath('/admin/album-candidates')
  await revalidateEventPublic(album.eventId)
  return {}
}

/** Re-scrape the album host for a fresh Open Graph cover image. */
export async function refetchAlbumCover(candidateId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const loaded = await loadPublishedAlbum(candidateId)
  if ('error' in loaded) return loaded
  const { db, cand, album } = loaded

  const image = await fetchOgImage(album.canonicalUrl ?? album.url)
  if (!image) return { error: 'Could not find a cover image on the album host.' }

  await db.update(albums).set({ coverImageUrl: image, updatedAt: new Date() }).where(eq(albums.id, album.id))
  const meta = (cand.rawMetadata ?? {}) as AlbumCandidateMetadata
  await db
    .update(albumCandidates)
    .set({ rawMetadata: { ...meta, coverImageUrl: image }, updatedAt: new Date() })
    .where(eq(albumCandidates.id, candidateId))

  revalidatePath('/admin/album-candidates')
  await revalidateEventPublic(album.eventId)
  return {}
}

/**
 * Store a manually-uploaded cover image for a published album (in-DB), and point
 * the album's cover_image_url at the serving route with a cache-busting version.
 * The fallback for hosts we can't OG-scrape (Drive/Dropbox folders, blocked Flickr).
 *
 * The upload is downscaled, re-encoded to WebP and stripped of EXIF here, on the
 * server, by lib/images/normalise.ts. The browser-side shrink in
 * candidate-actions.tsx saves bandwidth but is not trusted or depended on.
 */
export async function uploadAlbumCover(candidateId: string, formData: FormData): Promise<{ error?: string }> {
  await assertAdmin()
  const file = formData.get('cover')
  if (!(file instanceof File) || file.size === 0) return { error: 'No image selected.' }

  const normalised = await normaliseUploadedImage(file, 'cover')
  if ('error' in normalised) return normalised
  const { data: bytes, contentType } = normalised.image

  const loaded = await loadPublishedAlbum(candidateId)
  if ('error' in loaded) return loaded
  const { db, album } = loaded

  await db
    .insert(albumCovers)
    .values({ albumId: album.id, contentType, data: bytes, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: albumCovers.albumId,
      set: { contentType, data: bytes, updatedAt: new Date() },
    })

  const coverUrl = `/api/albums/cover/${album.id}?v=${Date.now()}`
  await db.update(albums).set({ coverImageUrl: coverUrl, updatedAt: new Date() }).where(eq(albums.id, album.id))

  revalidatePath('/admin/album-candidates')
  await revalidateEventPublic(album.eventId)
  return {}
}

/**
 * Remove a published album. Deletes the album + its source evidence and returns
 * the candidate to 'suppressed' (it keeps its event match, so it can be
 * re-approved later if the removal was a mistake).
 *
 * THE ONLY ROUTE A LIVE ALBUM COMES DOWN, which is why the takedown email is
 * wired here. Suppress on this screen is only ever offered on a candidate that
 * was never published, so it sends the "we did not list it" email instead. The
 * reason is required on both, because the reason is the email.
 */
export async function deletePublishedAlbum(
  candidateId: string,
  reason: string,
): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = reason?.trim() ?? ''
  if (!clean) return { error: 'Give a reason. It is what the submitter is told.' }

  const loaded = await loadPublishedAlbum(candidateId)
  if ('error' in loaded) return loaded
  const { db, album } = loaded

  await db
    .update(albumCandidates)
    .set({ status: 'suppressed', matchedAlbumId: null, rejectionReason: clean, updatedAt: new Date() })
    .where(eq(albumCandidates.id, candidateId))
  await db.delete(albumSources).where(eq(albumSources.albumId, album.id))
  await db.delete(albums).where(eq(albums.id, album.id))
  // wasLive is true by construction: loadPublishedAlbum refuses anything else.
  await notifyAlbumCandidateRejected(candidateId, true, clean)

  revalidatePath('/admin/album-candidates')
  await revalidateEventPublic(album.eventId)
  return {}
}

export async function approveAlbumCandidate(candidateId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const result = await adminPublishAlbum(candidateId)
  revalidatePath('/admin/album-candidates')
  if ('error' in result) return { error: result.error }
  // The photographer who sent it in now manages the album card, unless they
  // ticked the "just passing it along" box.
  await grantAlbumOwnership(candidateId, result.albumId)
  await notifyAlbumPublished(candidateId, result.eventId)
  // Refresh the public pages (incl. the parent championship if a division).
  await revalidateEventPublic(result.eventId)
  return {}
}

/** Internal reason a crawled candidate carries when an admin one-click suppresses it. */
const MANUAL_SCRAPED_REASON = 'manual_reject'

/**
 * Refuse an album, or take down one that is already on an event page.
 *
 * The reason is only a message to a submitter when there IS one. A crawled
 * candidate (no submission row) has nobody to tell, so the reason is not
 * required and defaults to an internal slug: the queue is full of scraped rows
 * and forcing a sentence on each one just slows the moderator down. A submitted
 * candidate still requires the reason, because there the reason IS the email.
 * deletePublishedAlbum is the harder takedown next to this one and always has a
 * submitter to notify, so it keeps its own required reason.
 */
export async function suppressAlbumCandidate(
  candidateId: string,
  rejectionReason?: string,
): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = rejectionReason?.trim() ?? ''

  const db = getDb()
  const [before] = await db
    .select({ status: albumCandidates.status, submissionId: albumCandidates.submissionId })
    .from(albumCandidates)
    .where(eq(albumCandidates.id, candidateId))
    .limit(1)
  if (!before) return { error: 'Candidate not found' }

  const fromSubmission = before.submissionId != null
  // Only a submitted candidate has someone to email, so only it needs the reason.
  if (fromSubmission && !clean) return { error: 'Give a reason. It is what the submitter is told.' }
  const reason = clean || MANUAL_SCRAPED_REASON

  await db
    .update(albumCandidates)
    .set({ status: 'suppressed', rejectionReason: reason, updatedAt: new Date() })
    .where(eq(albumCandidates.id, candidateId))
  // No-ops when there is no submission/submitter, so it is safe on scraped rows.
  await notifyAlbumCandidateRejected(candidateId, before.status === 'published', reason)
  revalidatePath('/admin/album-candidates')
  return {}
}

/** FLL albums can't be tied to one event; they clear to this distinct reason. */
const FLL_NO_EVENT_REASON = 'fll_no_event_mapping'
/** Reason a crawled album with no event match is retired from the queue. */
const NO_MATCH_REASON = 'no event match after crawl'

/**
 * Clear the "no event matched" backlog in one action. These are crawled albums
 * (no submitter) the machine could not tie to an event: they sit in 'pending'
 * forever with nothing to revisit them. Suppress them all so the queue only
 * holds rows a human can actually act on. FLL rows carry the distinct
 * 'fll_no_event_mapping' reason (they can never map to an event); the rest carry
 * "no event match after crawl". Nothing is deleted - both are filterable under
 * the suppressed tab and can be re-analyzed or re-matched later.
 *
 * No email is sent: these have no submissionId, so there is no submitter to tell.
 */
export async function suppressUnmatchedBacklog(): Promise<{ error?: string; count?: number }> {
  await assertAdmin()
  const db = getDb()

  // Only crawled (submissionId null), pending, no matched event: the machine
  // gave up. A public submission stays actionable and is never touched here.
  const unmatched = and(
    eq(albumCandidates.status, 'pending'),
    isNull(albumCandidates.matchedEventId),
    isNull(albumCandidates.submissionId),
  )!

  const fllOnly = sql`${albumCandidates.rawMetadata}->>'targetProgram' = 'fll'`
  const notFll = sql`(${albumCandidates.rawMetadata}->>'targetProgram' is distinct from 'fll')`

  const fll = await db
    .update(albumCandidates)
    .set({ status: 'suppressed', rejectionReason: FLL_NO_EVENT_REASON, updatedAt: new Date() })
    .where(and(unmatched, fllOnly))
    .returning({ id: albumCandidates.id })

  const rest = await db
    .update(albumCandidates)
    .set({ status: 'suppressed', rejectionReason: NO_MATCH_REASON, updatedAt: new Date() })
    .where(and(unmatched, notFll))
    .returning({ id: albumCandidates.id })

  revalidatePath('/admin/album-candidates')
  return { count: fll.length + rest.length }
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

  // If it's already published, repoint the live album and refresh both pages
  // (old + new, each parent-aware for championship divisions).
  if (cand.matchedAlbumId) {
    await db.update(albums).set({ eventId: event.id, updatedAt: new Date() }).where(eq(albums.id, cand.matchedAlbumId))
    await revalidateEventPublic(event.id)
    if (oldKey && oldKey !== event.tbaKey) revalidatePath(`/photos/event/${oldKey}`)
  } else if (cand.status !== 'published') {
    // Setting the event on a not-yet-published candidate IS the approval:
    // publish it straight away so there's no separate approve step.
    const result = await adminPublishAlbum(candidateId)
    if ('error' in result) {
      revalidatePath('/admin/album-candidates')
      return { error: result.error }
    }
    // The second publish door, and it has to notify AND grant too: setting the
    // event on a pending candidate IS the approval, so a submitter whose album
    // went live this way would otherwise be the only one who never heard and
    // the only one who never got their listing.
    await grantAlbumOwnership(candidateId, result.albumId)
    await notifyAlbumPublished(candidateId, result.eventId)
    await revalidateEventPublic(result.eventId)
  }

  revalidatePath('/admin/album-candidates')
  return {}
}
