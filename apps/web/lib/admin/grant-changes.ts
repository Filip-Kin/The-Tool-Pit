import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { grantChanges, grantCycles, grants } from '@the-tool-pit/db'
import { coerceChangeValue, resolveChangeField } from '@/lib/admin/grants'

/**
 * The cycle columns that ARE the dates teams plan around. Applying one of
 * these is a person vouching for the dates; applying any other cycle column
 * is not, and must not move verifiedAt or clear isEstimated.
 */
function isDateColumn(column: string): boolean {
  return column === 'deadlineAt' || column === 'opensAt'
}

export interface ApplyChangeOutcome {
  error?: string
  /** The grant the change was written to, for cache revalidation. */
  grant?: { id: string; slug: string }
}

/**
 * Apply one grant_changes row to its grant or cycle and mark it applied by
 * `who`. One body for the admin Apply button and for an admin's own "suggest
 * an edit", so both write the same rows.
 *
 * The change queue is the ONLY path by which a scraped date reaches a
 * published listing. A monitor pass files a row in grant_changes and stops;
 * applying one here is a person saying "I opened the funder's page and this is
 * right", which is why applying stamps verifiedAt / verifiedBy.
 *
 * Deadline-class changes (priority 0) require `confirmed`. The UI puts that
 * behind a tickbox and this re-checks it rather than trusting the UI.
 */
export async function applyGrantChangeRow(
  changeId: string,
  who: string,
  options: { confirmed: boolean },
): Promise<ApplyChangeOutcome> {
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

  // An advisory change has no column to write. It is a prompt to go and read
  // something, not a value to apply.
  if (target.advisory) {
    return {
      error: `${target.label} changed on the funder's page. There is no field to apply it to: open the grant's requirements, check them against the new wording, then dismiss this.`,
    }
  }

  if (target.priority === 0 && !options.confirmed) {
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
      // Only a DATE column counts as confirming the dates. Applying a status
      // or a note must not promote an estimated deadline into a confirmed one.
      if (isDateColumn(target.column)) {
        patch.verifiedAt = now
        patch.verifiedBy = who
        patch.isEstimated = false
      }
      await db.update(grantCycles).set(patch).where(eq(grantCycles.id, cycle.id))
    } else {
      // A new year appearing on a page the grant already had no cycle for.
      // Still only created by a person applying it.
      const insert: Record<string, unknown> = {
        grantId: grant.id,
        cycleYear,
        status: 'unknown',
        [target.column]: coerced.value,
        isEstimated: false,
      }
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

  return { grant }
}
