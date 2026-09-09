'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { grantChanges } from '@the-tool-pit/db'
import { adminIdentity, revalidateGrantPublic } from '@/lib/admin/grants'
import { applyGrantChangeRow } from '@/lib/admin/grant-changes'

const QUEUE_PATH = '/admin/grants/changes'

/**
 * Apply a change to its listing. The body is applyGrantChangeRow in
 * lib/admin/grant-changes.ts; this checks the admin and revalidates.
 */
export async function applyGrantChange(changeId: string, confirmed: boolean): Promise<{ error?: string }> {
  await assertAdmin()
  const who = await adminIdentity()
  const out = await applyGrantChangeRow(changeId, who, { confirmed })
  if (out.error || !out.grant) return { error: out.error }

  revalidatePath(QUEUE_PATH)
  revalidatePath(`/admin/grants/${out.grant.id}`)
  revalidateGrantPublic(out.grant.slug)
  return {}
}

/**
 * Dismiss a change without touching the listing. Records who said no, because
 * a field that keeps being dismissed is an extractor bug, not a busy admin.
 */
export async function dismissGrantChange(changeId: string, note?: string): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()

  const [change] = await db
    .select({ id: grantChanges.id, status: grantChanges.status, reasoning: grantChanges.reasoning })
    .from(grantChanges)
    .where(eq(grantChanges.id, changeId))
    .limit(1)
  if (!change) return { error: 'Change not found.' }
  if (change.status !== 'pending') return { error: `This change was already ${change.status}.` }

  const who = await adminIdentity()
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

  revalidatePath(QUEUE_PATH)
  return {}
}

/** Put a change back in the queue after a wrong dismissal. */
export async function reopenGrantChange(changeId: string): Promise<{ error?: string }> {
  await assertAdmin()
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
  revalidatePath(QUEUE_PATH)
  return {}
}
