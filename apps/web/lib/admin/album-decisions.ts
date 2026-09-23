import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import { albumCandidates, albums, events } from '@the-tool-pit/db'
import { adminPublishAlbum } from '@/lib/admin/publish-album'
import { notifyAlbumPublished, notifyAlbumCandidateRejected } from '@/lib/notify/approvals'
import { grantAlbumOwnership } from '@/lib/listings/submitter-ownership'

/**
 * Album candidate decisions. One body each for the admin buttons and for a
 * reaction in Discord, so both write the same rows.
 */

const CMP_DIVISION_TYPES = new Set([3, 5])

/**
 * Bust the public caches an album on this event affects: the home feed, the
 * event's own page, and - if the event is a championship division - the parent
 * championship page, since the division's albums are rolled up and shown there.
 */
export async function revalidateEventPublic(eventId: string | null | undefined): Promise<void> {
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

/** Publish the album, hand it to the photographer, tell them, refresh the pages it appears on. */
export async function approveAlbumCandidateBody(candidateId: string): Promise<{ error?: string; eventId?: string }> {
  const result = await adminPublishAlbum(candidateId)
  if ('error' in result) return { error: result.error }
  // The photographer who sent it in now manages the album card, unless they
  // ticked the "just passing it along" box.
  await grantAlbumOwnership(candidateId, result.albumId)
  await notifyAlbumPublished(candidateId, result.eventId)
  // Refresh the public pages (incl. the parent championship if a division).
  await revalidateEventPublic(result.eventId)
  return { eventId: result.eventId }
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
 */
export async function suppressAlbumCandidateBody(candidateId: string, rejectionReason?: string): Promise<{ error?: string }> {
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
  return {}
}

/**
 * Set or change the event for a candidate by its full TBA key (year + code).
 * Works for pending, matched, AND published candidates - for a published one it
 * also repoints the live album and refreshes the affected event pages. On a
 * candidate not yet published, setting the event IS the approval: it publishes.
 *
 * Shared by the admin action (which adds assertAdmin and revalidates the queue
 * page) and /api/internal/queue-decisions.
 */
export async function setAlbumEventMatchBody(candidateId: string, eventKey: string): Promise<{ error?: string }> {
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
    if ('error' in result) return { error: result.error }
    // The second publish door, and it has to notify AND grant too: setting the
    // event on a pending candidate IS the approval, so a submitter whose album
    // went live this way would otherwise be the only one who never heard and
    // the only one who never got their listing.
    await grantAlbumOwnership(candidateId, result.albumId)
    await notifyAlbumPublished(candidateId, result.eventId)
    await revalidateEventPublic(result.eventId)
  }

  return {}
}
