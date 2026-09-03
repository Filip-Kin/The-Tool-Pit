'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, inArray, ne, or } from 'drizzle-orm'
import { Queue } from 'bullmq'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { getRedis } from '@/lib/redis'
import { eventListingCandidates, eventListings } from '@the-tool-pit/db'
import { bumpListingSourceCounter, eventListingFromCandidate } from '@/lib/admin/listing-discovery'
import { eventPublishBlockers } from '@/lib/events/publish-bar'
import { geocodeVenue } from '@the-tool-pit/db/geocode'
import { addHumanEdits, changedKeys, HUMAN_EDITABLE_EVENT_KEYS } from '@the-tool-pit/db/human-edited'
import { diffEventFields, type EventMergeField } from '@/lib/admin/event-merge'
import type { ExtractedEventListingFields } from '@the-tool-pit/db'

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
 * Read a just-accepted listing's team list right now, rather than waiting for
 * the 05:50 cron. Publishing an event used to do nothing for its roster, so a
 * listing sat with no count for up to a day. The roster-refresh worker takes a
 * `listingId` and does exactly one listing, so this enqueues that job for the
 * new row. Only worth firing when there is somewhere to read from: a team-list
 * URL or a TBA key. Best-effort, so a Redis hiccup never fails the publish.
 */
async function enqueueImmediateRosterRefresh(
  listing: { id: string; teamListUrl?: string | null; tbaKey?: string | null },
): Promise<void> {
  if (!listing.teamListUrl && !listing.tbaKey) return
  try {
    const queue = new Queue<{ listingId: string }>('roster-refresh', {
      connection: getRedis(),
      defaultJobOptions: { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 } },
    })
    await queue.add('roster-refresh', { listingId: listing.id })
  } catch (err) {
    console.error(`[event-candidates] could not enqueue roster refresh for ${listing.id}:`, err)
  }
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
 * Mark every other PENDING candidate for the same event as a duplicate.
 *
 * The same off-season event reaches us twice: TBA codes it and someone posts a
 * Chief Delphi thread, so two candidates describe one event. Insert-time dedupe
 * runs on tba_key and canonical URL, but publishing one candidate did nothing
 * to its twin, which sat in pending until a human noticed (2026cc, 2026nycrr,
 * 2026rsr were exactly this). Publishing now closes the twin.
 *
 * Two ways to recognise a twin, matching how the crawler dedupes at insert:
 *   - the SAME non-null tba_key. The published candidate carries one, or the
 *     admin typed one onto the listing while accepting a keyless CD thread, and
 *     that key is read back off the listing here. This is what closes a TBA
 *     twin of a published CD candidate and the reverse.
 *   - the SAME canonical or source URL, which closes a second lead scraped off
 *     the very page this one came from.
 *
 * Idempotent: it only touches rows still 'pending', so a second publish for the
 * same event finds nothing left to close, and the just-published candidate is
 * excluded by both its status and its id.
 */
async function closeTwinCandidates(
  candidate: { id: string; tbaKey: string | null; canonicalUrl: string | null; sourceUrl: string },
  listingId: string,
): Promise<void> {
  const db = getDb()

  const [listing] = await db
    .select({ tbaKey: eventListings.tbaKey })
    .from(eventListings)
    .where(eq(eventListings.id, listingId))
    .limit(1)

  const keys = [...new Set([candidate.tbaKey, listing?.tbaKey].filter((k): k is string => Boolean(k && k.trim())))]
  const urls = [...new Set([candidate.canonicalUrl, candidate.sourceUrl].filter((u): u is string => Boolean(u && u.trim())))]

  const matchers = []
  if (keys.length) matchers.push(inArray(eventListingCandidates.tbaKey, keys))
  if (urls.length) {
    matchers.push(inArray(eventListingCandidates.canonicalUrl, urls))
    matchers.push(inArray(eventListingCandidates.sourceUrl, urls))
  }
  if (matchers.length === 0) return

  await db
    .update(eventListingCandidates)
    .set({
      status: 'duplicate',
      matchedListingId: listingId,
      rejectionReason: 'Duplicate of a candidate already published for this event',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(eventListingCandidates.status, 'pending'),
        ne(eventListingCandidates.id, candidate.id),
        or(...matchers),
      ),
    )
}

/**
 * Accept a candidate into a pending listing.
 *
 * `name` comes from the form because event_listings.name is NOT NULL and a
 * connector that could not read a name leaves it undefined rather than
 * inventing one. The reviewer confirms it; everything else is copied off
 * `extracted` verbatim.
 */
/**
 * Accept a candidate, with whatever the reviewer corrected on the way through.
 *
 * The values come off the review form, so a wrong venue is fixed by typing in
 * the box next to the quote that produced it, not by accepting a listing and
 * then hunting for it on another screen. What the reviewer posts wins over what
 * the reader found; a field they cleared is cleared.
 */
export async function acceptEventCandidate(
  candidateId: string,
  values: Record<string, string>,
): Promise<{ error?: string; listingId?: string; pending?: string }> {
  await assertAdmin()
  const db = getDb()

  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }
  if (candidate.matchedListingId) return { error: 'This candidate is already attached to a listing.' }

  const clean = (values.name ?? '').trim()
  if (!clean) return { error: 'Give the event a name before accepting it.' }

  // The reviewer's edits, folded onto the candidate before it is mapped.
  const corrected = { ...(candidate.extracted ?? {}), ...parseEventValues(values) }
  candidate.extracted = corrected as typeof candidate.extracted

  // ACCEPT MEANS PUBLISH. A moderator reading the candidate, checking the
  // quotes and pressing Accept IS the review, and sending it to the pending
  // queue afterwards asked them to review the same event twice. That queue is
  // for listings the public submitted, which nobody has looked at yet.
  //
  // The publish bar still applies, because it is what stops a half-filled row
  // reaching the map. A candidate that does not clear it is written as pending
  // and the reviewer is told exactly which field is missing.
  const row = eventListingFromCandidate(candidate, clean)

  // A PIN IS A LOOKUP, so do it here rather than refusing over it.
  //
  // The read geocodes what it finds, but a candidate read before that existed
  // has no pin, and a moderator who has just corrected the address in the form
  // should not be told to go and find the building on a map. Same strictness as
  // the reader: a real address or a venue with a town, and the answer has to
  // land in the state the row claims.
  if (row.latitude == null || row.longitude == null) {
    const located = await geocodeVenue({
      venueName: row.venueName,
      address: row.address,
      city: row.city,
      region: row.region,
      country: row.country,
    })
    if (located) {
      row.latitude = located.latitude
      row.longitude = located.longitude
    }
  }

  const missing = eventPublishBlockers({
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    startDate: row.startDate ?? null,
    venueName: row.venueName ?? null,
    address: row.address ?? null,
    program: row.program ?? null,
    registrationStatus: row.registrationStatus ?? null,
  })

  const [created] = await db
    .insert(eventListings)
    .values(
      missing.length === 0
        ? { ...row, status: 'published', publishedAt: new Date() }
        : row,
    )
    .returning({ id: eventListings.id })
  if (!created) return { error: 'The listing was not written. Nothing has changed.' }

  await db
    .update(eventListingCandidates)
    .set({ status: 'published', matchedListingId: created.id, rejectionReason: null, updatedAt: new Date() })
    .where(eq(eventListingCandidates.id, candidateId))
  await bumpListingSourceCounter('event', candidate.sourceId, 'yield')

  // Close the twin. The same off-season event surfaces from TBA and from a
  // Chief Delphi thread as two separate candidates; dedupe only runs at insert
  // time, so publishing one used to leave its twin sitting in pending forever.
  await closeTwinCandidates(candidate, created.id)

  // Read the team list straight away instead of waiting for the daily sweep.
  // The row carries whatever source it has; the worker picks website vs TBA.
  await enqueueImmediateRosterRefresh({ id: created.id, teamListUrl: row.teamListUrl, tbaKey: row.tbaKey })

  revalidateAll()
  return {
    listingId: created.id,
    // Not an error: the listing exists either way. This is the difference
    // between "it is on the map" and "it needs one more thing from you".
    pending: missing.length > 0 ? `Saved, not published yet. Add ${missing.join(', and ')}.` : undefined,
  }
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
  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  const ref = await findListing(listingRef)
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
  const candidate = await loadCandidate(candidateId)
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

/**
 * Form strings back into the shape `extracted` holds.
 *
 * An empty box means "cleared", so it becomes undefined and the mapping leaves
 * the column null. That is the difference between a reviewer deleting a wrong
 * venue and a reviewer never touching it.
 */
function parseEventValues(values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const numbers = new Set(['hostTeamNumber', 'capacity', 'costUsd', 'days'])
  const booleans = new Set(['parallelDivisions'])

  for (const [key, raw] of Object.entries(values)) {
    const value = raw.trim()
    if (booleans.has(key)) {
      out[key] = value === 'true'
      continue
    }
    if (value === '') {
      out[key] = undefined
      continue
    }
    if (numbers.has(key)) {
      const n = Number(value.replace(/[^0-9.]/g, ''))
      out[key] = Number.isFinite(n) ? Math.round(n) : undefined
      continue
    }
    out[key] = value
  }
  return out
}
