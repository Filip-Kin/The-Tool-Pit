import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { eventListings } from '@the-tool-pit/db'
import { notifyEventRejected } from '@/lib/notify/approvals'

/**
 * Refuse a pending listing, or take a live one back off the map. One body for
 * the admin Suppress button and for a ❌ in Discord.
 *
 * Same double duty as suppressPracticeField, same fix: the status is read
 * before it is written, and the submitter gets the email that matches what
 * actually happened. The reason is required because it is the body of that
 * email. The caller revalidates.
 */
export async function suppressEventListing(id: string, reason: string): Promise<{ error?: string }> {
  const clean = reason?.trim() ?? ''
  if (!clean) return { error: 'Give a reason. It is what the submitter is told.' }

  const db = getDb()
  const [before] = await db
    .select({ status: eventListings.status })
    .from(eventListings)
    .where(eq(eventListings.id, id))
    .limit(1)
  if (!before) return { error: 'Event not found' }

  await db
    .update(eventListings)
    .set({ status: 'suppressed', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(eventListings.id, id))
  await notifyEventRejected(id, before.status === 'published', clean)
  return {}
}
