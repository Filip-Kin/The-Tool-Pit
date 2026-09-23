import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { grantChanges } from '@the-tool-pit/db'
import { applyGrantChangeRow, type ApplyChangeOutcome } from '@/lib/admin/grant-changes'

/**
 * Grant change (monitor diff) decisions. One body each, shared by the admin
 * buttons in app/admin/grants/changes/actions.ts and by
 * /api/internal/queue-decisions. The callers own auth and cache revalidation;
 * every write is here so both callers get it. Same split as
 * lib/admin/grant-decisions.ts for candidates.
 *
 * `who` is the name stamped on reviewedBy, and on verifiedBy when an apply
 * confirms a date. The admin action passes adminIdentity(); the monitor's
 * proven auto-apply passes 'auto'.
 */

/**
 * Apply one change to its listing. The body is applyGrantChangeRow in
 * lib/admin/grant-changes.ts, which the "suggest an edit" path also uses.
 * `confirmed` is the deadline-class tickbox; an internal caller's decision is
 * its own confirmation and passes true.
 */
export async function applyGrantChangeBody(changeId: string, who: string, options: { confirmed: boolean }): Promise<ApplyChangeOutcome> {
  return applyGrantChangeRow(changeId, who, options)
}

/**
 * Dismiss a change without touching the listing. Records who said no, because
 * a field that keeps being dismissed is an extractor bug, not a busy admin.
 */
export async function dismissGrantChangeBody(changeId: string, who: string, note?: string): Promise<{ error?: string }> {
  const db = getDb()

  const [change] = await db
    .select({ id: grantChanges.id, status: grantChanges.status, reasoning: grantChanges.reasoning })
    .from(grantChanges)
    .where(eq(grantChanges.id, changeId))
    .limit(1)
  if (!change) return { error: 'Change not found.' }
  if (change.status !== 'pending') return { error: `This change was already ${change.status}.` }

  const clean = note?.trim()
  await db
    .update(grantChanges)
    .set({
      status: 'dismissed',
      reviewedBy: who,
      reviewedAt: new Date(),
      // The dismissal note is appended to the extractor's own reasoning rather
      // than replacing it, so the audit trail keeps both sides of the call.
      reasoning: clean ? [change.reasoning, `Dismissed: ${clean}`].filter(Boolean).join('\n\n') : change.reasoning,
    })
    .where(eq(grantChanges.id, changeId))
  return {}
}

/** Put a change back in the queue after a wrong dismissal. */
export async function reopenGrantChangeBody(changeId: string): Promise<{ error?: string }> {
  const db = getDb()
  const [change] = await db
    .select({ status: grantChanges.status })
    .from(grantChanges)
    .where(eq(grantChanges.id, changeId))
    .limit(1)
  if (!change) return { error: 'Change not found.' }
  if (change.status === 'applied') {
    // Reopening an applied change would offer to re-write a value that is
    // already on the listing. Editing the grant is the honest way back.
    return { error: 'This one was applied. Correct it in the grant editor instead.' }
  }

  await db
    .update(grantChanges)
    .set({ status: 'pending', reviewedBy: null, reviewedAt: null })
    .where(eq(grantChanges.id, changeId))
  return {}
}
