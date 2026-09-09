import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListings } from '@the-tool-pit/db'
import { notifyEventPublished } from '@/lib/notify/approvals'
import { grantEventOwnership } from '@/lib/listings/submitter-ownership'
import { eventPublishBlockers } from '@/lib/events/publish-bar'

/**
 * Publish an event listing. One body for the admin Approve button and for an
 * admin's own submission, so both write the same rows. Knows nothing about
 * sessions or cache revalidation; the caller does those.
 */
export async function publishEventListing(
  id: string,
  options: { notifySubmitter?: boolean } = {},
): Promise<{ error?: string }> {
  const db = getDb()
  const [e] = await db
    .select({
      latitude: eventListings.latitude,
      longitude: eventListings.longitude,
      startDate: eventListings.startDate,
      venueName: eventListings.venueName,
      address: eventListings.address,
      program: eventListings.program,
      registrationStatus: eventListings.registrationStatus,
    })
    .from(eventListings)
    .where(eq(eventListings.id, id))
    .limit(1)
  if (!e) return { error: 'Event not found' }

  const missing = eventPublishBlockers(e)
  if (missing.length > 0) {
    // Name everything missing at once. A reviewer who fixes one item, presses
    // the button and is told about the next one learns to dread the button.
    return { error: `Not ready to publish. Add ${missing.join(', and ')}.` }
  }
  await db
    .update(eventListings)
    .set({ status: 'published', publishedAt: new Date(), rejectionReason: null, updatedAt: new Date() })
    .where(eq(eventListings.id, id))
  // The organiser who filled this in now runs it, unless they said otherwise.
  await grantEventOwnership(id)
  // The "your listing is live" email. Off when the submitter is the admin who
  // just published it.
  if (options.notifySubmitter !== false) await notifyEventPublished(id)
  return {}
}
