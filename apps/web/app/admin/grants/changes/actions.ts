'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { grantChanges, grantCycles, grants } from '@the-tool-pit/db'
import {
  adminIdentity,
  coerceChangeValue,
  resolveChangeField,
  revalidateGrantPublic,
} from '@/lib/admin/grants'

const QUEUE_PATH = '/admin/grants/changes'

/**
 * The cycle columns that ARE the dates teams plan around. Applying one of
 * these is a person vouching for the dates; applying any other cycle column
 * is not, and must not move verifiedAt or clear isEstimated.
 */
function isDateColumn(column: string): boolean {
  return column === 'deadlineAt' || column === 'opensAt'
}

/**
 * The change queue is the ONLY path by which a scraped date reaches a
 * published listing. A monitor pass files a row in grant_changes and stops;
 * applying one here is a person saying "I opened the funder's page and this is
 * right", which is why applying stamps verifiedAt / verifiedBy.
 *
 * Deadline-class changes (priority 0: the deadline itself, the opening date,
 * the deadline note, the cycle status, the deadline type) additionally require
 * an explicit confirmation flag. The UI puts that behind a tickbox, and this
 * action re-checks it rather than trusting the UI, because a wrong deadline is
 * worse than no deadline and a stray click should not be able to publish one.
 */
export async function applyGrantChange(changeId: string, confirmed: boolean): Promise<{ error?: string }> {
  await assertAdmin()
  const db = getDb()

  const [change] = await db.select().from(grantChanges).where(eq(grantChanges.id, changeId)).limit(1)
  if (!change) return { error: 'Change not found.' }
  if (change.status !== 'pending') return { error: `This change was already ${change.status}.` }

  const resolved = resolveChangeField(change.field)
  if (!resolved) {
    // Refuse rather than guess. An unrecognised path means the extractor and
    // this allowlist have drifted, and guessing a column writes a date onto
    // the wrong field.
    return { error: `"${change.field}" is not a field this screen knows how to apply. Dismiss it and fix the extractor.` }
  }
  const { target, cycleYear } = resolved

  if (target.priority === 0 && !confirmed) {
    return { error: 'Tick the confirmation first. This one moves a date that teams plan around.' }
  }

  const coerced = coerceChangeValue(change.newValue, target.type)
  if (!coerced.ok) return { error: coerced.error }

  const [grant] = await db
    .select({ id: grants.id, slug: grants.slug })
    .from(grants)
    .where(eq(grants.id, change.grantId))
    .limit(1)
  if (!grant) return { error: 'The grant this change belongs to has gone.' }

  const who = await adminIdentity()
  const now = new Date()

  if (target.table === 'grant') {
    const patch: Record<string, unknown> = {
      [target.column]: coerced.value,
      // A human just checked this fact, so the listing's "verified on" line
      // moves with it. Same reason publishing a candidate stamps it.
      verifiedAt: now,
      verifiedBy: who,
      updatedAt: now,
    }
    await db.update(grants).set(patch).where(eq(grants.id, grant.id))
  } else {
    if (cycleYear == null) return { error: 'Cycle change with no year in its path.' }
    const [cycle] = await db
      .select({ id: grantCycles.id })
      .from(grantCycles)
      .where(and(eq(grantCycles.grantId, grant.id), eq(grantCycles.cycleYear, cycleYear)))
      .limit(1)

    if (cycle) {
      const patch: Record<string, unknown> = {
        [target.column]: coerced.value,
        updatedAt: now,
      }
      // Only a DATE column counts as confirming the dates.
      //
      // This used to stamp verifiedAt and clear isEstimated for any cycle
      // column at all, and CYCLE_CHANGE_TARGETS also allows status,
      // deadlineNote, decisionAt, amountNote and sourceUrl. So an admin
      // ticking "yes, the round is shut" on a cycle.<year>.status change would
      // silently promote a deliberately estimated deadline into a confirmed,
      // reminder-eligible one, and the public page would start claiming a
      // person had checked those dates today. Nobody had.
      if (isDateColumn(target.column)) {
        patch.verifiedAt = now
        patch.verifiedBy = who
        patch.isEstimated = false
      }
      await db.update(grantCycles).set(patch).where(eq(grantCycles.id, cycle.id))
    } else {
      // A new year appearing on a page the grant already had no cycle for.
      // This is the strictly-additive case grant_changes.autoApplicable
      // describes, and it is still only created by a person clicking apply.
      const insert: Record<string, unknown> = {
        grantId: grant.id,
        cycleYear,
        status: 'unknown',
        [target.column]: coerced.value,
        isEstimated: false,
      }
      // Same rule as the update path: creating a cycle by applying a note or a
      // status is not somebody confirming its dates, so it does not get to
      // claim they were.
      if (isDateColumn(target.column)) {
        insert.verifiedAt = now
        insert.verifiedBy = who
      }
      await db.insert(grantCycles).values(insert as never)
    }
  }

  await db
    .update(grantChanges)
    .set({ status: 'applied', reviewedBy: who, reviewedAt: now })
    .where(eq(grantChanges.id, changeId))

  revalidatePath(QUEUE_PATH)
  revalidatePath(`/admin/grants/${grant.id}`)
  revalidateGrantPublic(grant.slug)
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
