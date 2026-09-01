'use server'

import { revalidatePath } from 'next/cache'
import { eq, or } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { eventListingCandidates, eventListings } from '@the-tool-pit/db'
import { bumpListingSourceCounter, eventListingFromCandidate } from '@/lib/admin/listing-discovery'

const QUEUE_PATH = '/admin/event-listings/candidates'

/**
 * Off-season event candidate moderation.
 *
 * Accepting does not publish anything. It writes a `source: 'scrape'`,
 * `status: 'pending'` listing with no coordinates, so the crawler's find goes
 * through the same review and the same map-pin requirement a public submission
 * does. A wrong date on a published event is a team driving four hours to a
 * closed building, so the crawler never gets the last word.
 */

function revalidateAll() {
  revalidatePath(QUEUE_PATH)
  revalidatePath('/admin/event-listings')
}

async function loadCandidate(candidateId: string) {
  const db = getDb()
  const [row] = await db
    .select()
    .from(eventListingCandidates)
    .where(eq(eventListingCandidates.id, candidateId))
    .limit(1)
  return row ?? null
}

/**
 * Find a listing by uuid or TBA key. Admins have one or the other to hand: the
 * id from the listings screen, the key from the candidate itself.
 */
async function findListing(ref: string) {
  const clean = ref.trim().toLowerCase()
  if (!clean) return null
  const db = getDb()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)
  const [row] = await db
    .select({ id: eventListings.id, name: eventListings.name, tbaKey: eventListings.tbaKey })
    .from(eventListings)
    .where(isUuid ? or(eq(eventListings.id, clean), eq(eventListings.tbaKey, clean)) : eq(eventListings.tbaKey, clean))
    .limit(1)
  return row ?? null
}

/**
 * Accept a candidate into a pending listing.
 *
 * `name` comes from the form because event_listings.name is NOT NULL and a
 * connector that could not read a name leaves it undefined rather than
 * inventing one. The reviewer confirms it; everything else is copied off
 * `extracted` verbatim.
 */
export async function acceptEventCandidate(candidateId: string, name: string): Promise<{ error?: string; listingId?: string }> {
  await assertAdmin()
  const db = getDb()

  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }
  if (candidate.matchedListingId) return { error: 'This candidate is already attached to a listing.' }

  const clean = name.trim()
  if (!clean) return { error: 'Give the event a name before accepting it.' }

  const [created] = await db
    .insert(eventListings)
    .values(eventListingFromCandidate(candidate, clean))
    .returning({ id: eventListings.id })
  if (!created) return { error: 'The listing was not written. Nothing has changed.' }

  await db
    .update(eventListingCandidates)
    .set({ status: 'published', matchedListingId: created.id, rejectionReason: null, updatedAt: new Date() })
    .where(eq(eventListingCandidates.id, candidateId))
  await bumpListingSourceCounter('event', candidate.sourceId, 'yield')

  revalidateAll()
  return { listingId: created.id }
}

/**
 * Attach a candidate to a listing we already have. Used when the crawler found
 * a second page for a known event, e.g. the forum thread for something already
 * listed from TBA. The candidate becomes evidence, not a second listing, and it
 * still counts as a useful find for the source.
 */
export async function attachEventCandidate(candidateId: string, listingRef: string): Promise<{ error?: string }> {
  await assertAdmin()
  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  const listing = await findListing(listingRef)
  if (!listing) return { error: `No listing found for "${listingRef}". Paste its id or its TBA key.` }

  await getDb()
    .update(eventListingCandidates)
    .set({ status: 'matched', matchedListingId: listing.id, rejectionReason: null, updatedAt: new Date() })
    .where(eq(eventListingCandidates.id, candidateId))
  await bumpListingSourceCounter('event', candidate.sourceId, 'yield')

  revalidateAll()
  return {}
}

/**
 * Suppress with a reason. The reason is how a source that keeps filing threads
 * about last year's event gets recognised, and the reject bump is how it gets
 * spotted without reading the queue.
 */
export async function suppressEventCandidate(candidateId: string, reason: string): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = reason.trim()
  if (!clean) return { error: 'Give a reason, even a short one.' }

  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  await getDb()
    .update(eventListingCandidates)
    .set({ status: 'suppressed', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(eventListingCandidates.id, candidateId))
  await bumpListingSourceCounter('event', candidate.sourceId, 'reject')

  revalidateAll()
  return {}
}

/**
 * Mark a candidate as a duplicate. Deliberately does not touch the reject
 * tally: a source that finds the same real event twice is not a noisy source,
 * and mixing the two would hide the sources that are.
 */
export async function markEventCandidateDuplicate(candidateId: string, listingRef: string): Promise<{ error?: string }> {
  await assertAdmin()
  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  let matchedListingId: string | null = candidate.matchedListingId
  let note = 'Duplicate'
  if (listingRef.trim()) {
    const listing = await findListing(listingRef)
    if (!listing) return { error: `No listing found for "${listingRef}". Leave it blank if it duplicates another candidate.` }
    matchedListingId = listing.id
    note = `Duplicate of ${listing.name}`
  }

  await getDb()
    .update(eventListingCandidates)
    .set({ status: 'duplicate', matchedListingId, rejectionReason: note, updatedAt: new Date() })
    .where(eq(eventListingCandidates.id, candidateId))

  revalidateAll()
  return {}
}

/**
 * Put a candidate back in the pending queue after a wrong call. An accepted one
 * stays put: its listing exists, and reopening would invite a second copy.
 */
export async function reopenEventCandidate(candidateId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }
  if (candidate.status === 'published') {
    return { error: 'This one is already a listing. Delete the listing first if it should not exist.' }
  }

  await getDb()
    .update(eventListingCandidates)
    .set({ status: 'pending', rejectionReason: null, matchedListingId: null, updatedAt: new Date() })
    .where(eq(eventListingCandidates.id, candidateId))

  revalidateAll()
  return {}
}
