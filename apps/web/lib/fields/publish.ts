import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { practiceFields } from '@the-tool-pit/db'
import { notifyFieldPublished } from '@/lib/notify/approvals'
import { grantFieldOwnership } from '@/lib/listings/submitter-ownership'
import { fieldPublishBlockers } from '@/lib/fields/publish-bar'

/**
 * Publish a practice field. One body for the admin Approve button and for an
 * admin's own submission, so both write the same rows. Knows nothing about
 * sessions or cache revalidation; the caller does those.
 */
export async function publishPracticeField(
  id: string,
  options: { notifySubmitter?: boolean } = {},
): Promise<{ error?: string }> {
  const db = getDb()
  const [f] = await db
    .select({
      latitude: practiceFields.latitude,
      longitude: practiceFields.longitude,
      contactInfo: practiceFields.contactInfo,
      contactUrl: practiceFields.contactUrl,
      website: practiceFields.website,
    })
    .from(practiceFields)
    .where(eq(practiceFields.id, id))
    .limit(1)
  if (!f) return { error: 'Field not found' }

  const missing = fieldPublishBlockers(f)
  if (missing.length > 0) {
    // Name what is missing. "Cannot publish" with no reason is how a reviewer
    // ends up guessing, or editing the wrong field until the button works.
    return { error: `Not ready to publish. Add ${missing.join(', and ')}.` }
  }
  await db
    .update(practiceFields)
    .set({ status: 'published', publishedAt: new Date(), rejectionReason: null, updatedAt: new Date() })
    .where(eq(practiceFields.id, id))
  // After the publish, never before, and never in a way that can fail it. A
  // second click on Approve re-runs this and the outbox dedupe key collapses it
  // to the one email that already went.
  //
  // Ownership first, so Listings is already true when the email lands.
  // It does nothing for an anonymous submission or for somebody who ticked the
  // "just passing it along" box on the form.
  await grantFieldOwnership(id)
  if (options.notifySubmitter !== false) await notifyFieldPublished(id)
  return {}
}
