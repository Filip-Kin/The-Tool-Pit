'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { eventListingCandidates, eventListings } from '@the-tool-pit/db'
import { bumpListingSourceCounter } from '@/lib/admin/listing-discovery'
import { addHumanEdits, changedKeys, HUMAN_EDITABLE_EVENT_KEYS } from '@the-tool-pit/db/human-edited'
import { diffEventFields, type EventMergeField } from '@/lib/admin/event-merge'
import type { ExtractedEventListingFields } from '@the-tool-pit/db'
import {
  acceptEventCandidateBody,
  attachEventCandidateBody,
  findEventListing,
  loadEventCandidate,
  markEventCandidateDuplicateBody,
  suppressEventCandidateBody,
} from '@/lib/admin/event-candidate-decisions'

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

/**
 * Accept a candidate with the reviewer's corrections. Publishes when the row
 * clears the publish bar, otherwise saves it pending and names the missing
 * field. Body in lib/admin/event-candidate-decisions.ts.
 */
export async function acceptEventCandidate(
  candidateId: string,
  values: Record<string, string>,
): Promise<{ error?: string; listingId?: string; pending?: string }> {
  await assertAdmin()
  const out = await acceptEventCandidateBody(candidateId, values)
  if (out.error) return out
  revalidateAll()
  return out
}

/** Attach a candidate to a listing we already have. Body in lib/admin/event-candidate-decisions.ts. */
export async function attachEventCandidate(candidateId: string, listingRef: string): Promise<{ error?: string }> {
  await assertAdmin()
  const out = await attachEventCandidateBody(candidateId, listingRef)
  if (out.error) return out
  revalidateAll()
  return {}
}

/**
 * What the candidate found, next to what the listing already says.
 *
 * Read by the merge dialog before it asks a reviewer to decide anything, so
 * the decision is made on real values rather than on the reviewer's memory of
 * both pages.
 */
export async function compareEventCandidateToListing(
  candidateId: string,
  listingRef: string,
): Promise<{ error?: string; listingName?: string; fields?: EventMergeField[] }> {
  await assertAdmin()
  const candidate = await loadEventCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  const ref = await findEventListing(listingRef)
  if (!ref) return { error: `No listing found for "${listingRef}".` }

  const db = getDb()
  const [listing] = await db.select().from(eventListings).where(eq(eventListings.id, ref.id)).limit(1)
  if (!listing) return { error: 'Listing not found.' }

  const extracted = (candidate.extracted ?? {}) as ExtractedEventListingFields
  return { listingName: listing.name, fields: diffEventFields(listing, extracted) }
}

/**
 * Attach a candidate AND apply whichever fields the reviewer chose to take
 * from it.
 *
 * The values the reviewer picked are CLAIMED on the listing, the same as
 * typing them into the edit form. A reviewer choosing "detected" over
 * "existing" in the dialog is exactly as much a human decision as fixing a
 * date in the form is, and it needs the same protection: an automated refresh
 * must not silently put the old value back.
 */
export async function applyEventCandidateMerge(
  candidateId: string,
  listingId: string,
  chosen: Record<string, string>,
): Promise<{ error?: string }> {
  await assertAdmin()
  const candidate = await loadEventCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  const db = getDb()
  const [listing] = await db.select().from(eventListings).where(eq(eventListings.id, listingId)).limit(1)
  if (!listing) return { error: 'Listing not found.' }

  const extracted = (candidate.extracted ?? {}) as ExtractedEventListingFields
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(chosen)) {
    if (value !== 'detected') continue
    // costUsd / capacity / days are numeric columns; everything else here is
    // text. Passing a number through unchanged and everything else as-is
    // matches how extracted stores them.
    patch[key] = (extracted as Record<string, unknown>)[key]
  }

  if (Object.keys(patch).length > 0) {
    const claimed = changedKeys(patch, listing as unknown as Record<string, unknown>, HUMAN_EDITABLE_EVENT_KEYS)
    const humanEditedFields = addHumanEdits(listing.humanEditedFields, claimed)
    await db
      .update(eventListings)
      .set({ ...patch, ...(humanEditedFields ? { humanEditedFields } : {}), updatedAt: new Date() })
      .where(eq(eventListings.id, listingId))
  }

  await db
    .update(eventListingCandidates)
    .set({ status: 'matched', matchedListingId: listingId, rejectionReason: null, updatedAt: new Date() })
    .where(eq(eventListingCandidates.id, candidateId))
  await bumpListingSourceCounter('event', candidate.sourceId, 'yield')

  revalidateAll()
  return {}
}

/** Suppress with a reason. Body in lib/admin/event-candidate-decisions.ts. */
export async function suppressEventCandidate(candidateId: string, reason: string): Promise<{ error?: string }> {
  await assertAdmin()
  const out = await suppressEventCandidateBody(candidateId, reason)
  if (out.error) return out
  revalidateAll()
  return {}
}

/** Mark as a duplicate, not noise. Body in lib/admin/event-candidate-decisions.ts. */
export async function markEventCandidateDuplicate(candidateId: string, listingRef: string): Promise<{ error?: string }> {
  await assertAdmin()
  const out = await markEventCandidateDuplicateBody(candidateId, listingRef)
  if (out.error) return out
  revalidateAll()
  return {}
}

/**
 * Put a candidate back in the pending queue after a wrong call. An accepted one
 * stays put: its listing exists, and reopening would invite a second copy.
 */
export async function reopenEventCandidate(candidateId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const candidate = await loadEventCandidate(candidateId)
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
