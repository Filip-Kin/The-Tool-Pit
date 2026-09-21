import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { practiceFields } from '@the-tool-pit/db'
import { notifyFieldRejected } from '@/lib/notify/approvals'

/**
 * Refuse a pending field, or take a live one back off the map. One body for
 * the admin Suppress button and for a ❌ in Discord.
 *
 * Double duty, so the status is read before it is written and the submitter
 * gets the email that matches what actually happened. The reason is required
 * because it is the body of that email. Knows nothing about sessions or cache
 * revalidation; the caller does those.
 */
export async function suppressPracticeField(id: string, reason: string): Promise<{ error?: string }> {
  const clean = reason?.trim() ?? ''
  if (!clean) return { error: 'Give a reason. It is what the submitter is told.' }

  const db = getDb()
  const [before] = await db
    .select({ status: practiceFields.status })
    .from(practiceFields)
    .where(eq(practiceFields.id, id))
    .limit(1)
  if (!before) return { error: 'Field not found' }

  await db
    .update(practiceFields)
    .set({ status: 'suppressed', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(practiceFields.id, id))
  // After the write, never before, and never in a way that can fail it.
  await notifyFieldRejected(id, before.status === 'published', clean)
  return {}
}
