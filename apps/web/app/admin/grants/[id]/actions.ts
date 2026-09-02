'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, eq, ne } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { GRANT_STATUSES, grantCycles, grantFormFields, grantRequirements, grants } from '@the-tool-pit/db'
import type { FormFieldRowDraft } from '@/components/grants/admin-form-field-editor'
import {
  adminIdentity,
  parseCycleFields,
  parseFormFieldFields,
  parseGrantFields,
  parseRequirementFields,
  resolveFunderByName,
  revalidateGrantPublic,
  uniqueGrantSlug,
} from '@/lib/admin/grants'

/**
 * The grant editor's writes.
 *
 * Two rules run through all of it. First, a save is not a verification: editing
 * a summary does not move `verifiedAt`, because "verified on <date>" is a claim
 * that a person checked the FACTS against the funder's page, and if a typo fix
 * refreshed it the line would stop meaning anything. Verifying is its own
 * button. Second, every write revalidates the public pages, including a verify,
 * because the verified date is rendered publicly.
 */

async function loadGrant(grantId: string) {
  const db = getDb()
  const [row] = await db
    .select({ id: grants.id, slug: grants.slug, status: grants.status })
    .from(grants)
    .where(eq(grants.id, grantId))
    .limit(1)
  return row ?? null
}

/** Bust both the admin editor and whatever the public sees for this grant. */
function revalidateGrant(grantId: string, slug: string) {
  revalidatePath(`/admin/grants/${grantId}`)
  revalidatePath('/admin/grants')
  revalidateGrantPublic(slug)
}

/** Send the admin back to the editor with a message they can read. */
function backWithError(grantId: string, message: string): never {
  redirect(`/admin/grants/${grantId}?error=${encodeURIComponent(message)}`)
}

function backWithNote(grantId: string, message: string): never {
  redirect(`/admin/grants/${grantId}?saved=${encodeURIComponent(message)}`)
}

// #region the listing itself

/**
 * Save the grant's own fields.
 *
 * The slug is editable but does not follow the name. A slug is the URL a team
 * bookmarked and the one the public page is cached under, so renaming "Gene
 * Haas Foundation Grant" to add a year must not silently break every link to
 * it. Changing it is a deliberate act with its own box.
 */
export async function saveGrantForm(grantId: string, form: FormData): Promise<void> {
  await assertAdmin()
  const existing = await loadGrant(grantId)
  if (!existing) backWithError(grantId, 'Grant not found.')

  const parsed = parseGrantFields(form)
  if (parsed.error) backWithError(grantId, parsed.error)

  const db = getDb()
  const typedSlug = String(form.get('slug') ?? '').trim()
  const slug = typedSlug && typedSlug !== existing.slug ? await uniqueGrantSlug(typedSlug, grantId) : existing.slug

  const funderId = parsed.funderName ? await resolveFunderByName(parsed.funderName) : null
  const status = parsed.values.status ?? existing.status

  if (status === 'published') {
    // The form's status select is a second door to publish, so it gets the
    // same gate as setGrantStatusAction: an unverified grant cannot go public.
    // Teams read the verified date as a promise, so publishing something nobody
    // checked is the exact failure this vertical is built to avoid.
    const [row] = await db.select({ verifiedAt: grants.verifiedAt }).from(grants).where(eq(grants.id, grantId)).limit(1)
    if (!row?.verifiedAt) {
      backWithError(grantId, 'Verify the listing before publishing it. Teams read the verified date as a promise.')
    }
  }

  await db
    .update(grants)
    .set({
      ...parsed.values,
      slug,
      funderId,
      // publishedAt is the first time it went public and is never rewritten by
      // a later edit, so an "added on" line does not jump around.
      publishedAt: status === 'published' ? (await firstPublishedAt(grantId)) ?? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(grants.id, grantId))

  revalidateGrant(grantId, slug)
  if (slug !== existing.slug) revalidateGrantPublic(existing.slug)
  backWithNote(grantId, 'Saved.')
}

async function firstPublishedAt(grantId: string): Promise<Date | null> {
  const [row] = await getDb().select({ publishedAt: grants.publishedAt }).from(grants).where(eq(grants.id, grantId)).limit(1)
  return row?.publishedAt ?? null
}

/**
 * Stamp the grant as checked by a person, now.
 *
 * This is the whole "verified on" contract in one action. It writes no facts:
 * it only records that somebody opened the funder's page and found the listing
 * still correct. A crawl can never call this.
 */
export async function verifyGrantAction(grantId: string): Promise<void> {
  await assertAdmin()
  const existing = await loadGrant(grantId)
  if (!existing) backWithError(grantId, 'Grant not found.')

  const who = await adminIdentity()
  await getDb()
    .update(grants)
    .set({ verifiedAt: new Date(), verifiedBy: who, updatedAt: new Date() })
    .where(eq(grants.id, grantId))

  revalidateGrant(grantId, existing.slug)
  backWithNote(grantId, `Verified as ${who}.`)
}

/** Publish, unpublish, suppress or archive without touching any other field. */
export async function setGrantStatusAction(grantId: string, status: string): Promise<void> {
  await assertAdmin()
  if (!(GRANT_STATUSES as readonly string[]).includes(status)) backWithError(grantId, `Unknown status "${status}".`)
  const existing = await loadGrant(grantId)
  if (!existing) backWithError(grantId, 'Grant not found.')

  const db = getDb()
  if (status === 'published') {
    // Publishing something nobody has verified is the exact failure this whole
    // vertical is built to avoid, so it is refused rather than warned about.
    const [row] = await db.select({ verifiedAt: grants.verifiedAt }).from(grants).where(eq(grants.id, grantId)).limit(1)
    if (!row?.verifiedAt) {
      backWithError(grantId, 'Verify the listing before publishing it. Teams read the verified date as a promise.')
    }
  }

  await db
    .update(grants)
    .set({
      status,
      publishedAt: status === 'published' ? ((await firstPublishedAt(grantId)) ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(grants.id, grantId))

  revalidateGrant(grantId, existing.slug)
  backWithNote(grantId, `Status set to ${status}.`)
}

// #endregion

// #region cycles

/**
 * Create or update one cycle.
 *
 * Saving a cycle by hand stamps its own verifiedAt, unlike saving the grant.
 * The grant's stamp covers the description and the eligibility; a cycle's
 * covers the dates, which is the thing a team actually plans around, and they
 * go stale at completely different rates.
 */
export async function saveCycleForm(grantId: string, cycleId: string, form: FormData): Promise<void> {
  await assertAdmin()
  const existing = await loadGrant(grantId)
  if (!existing) backWithError(grantId, 'Grant not found.')

  const parsed = parseCycleFields(form)
  if (parsed.error) backWithError(grantId, parsed.error)

  const db = getDb()
  const who = await adminIdentity()
  const now = new Date()

  const clash = await db
    .select({ id: grantCycles.id })
    .from(grantCycles)
    .where(
      cycleId
        ? and(eq(grantCycles.grantId, grantId), eq(grantCycles.cycleYear, parsed.values.cycleYear), ne(grantCycles.id, cycleId))
        : and(eq(grantCycles.grantId, grantId), eq(grantCycles.cycleYear, parsed.values.cycleYear)),
    )
    .limit(1)
  if (clash.length > 0) backWithError(grantId, `There is already a ${parsed.values.cycleYear} cycle. Edit that one.`)

  if (cycleId) {
    await db
      .update(grantCycles)
      .set({ ...parsed.values, verifiedAt: now, verifiedBy: who, updatedAt: now })
      .where(and(eq(grantCycles.id, cycleId), eq(grantCycles.grantId, grantId)))
  } else {
    await db.insert(grantCycles).values({ grantId, ...parsed.values, verifiedAt: now, verifiedBy: who })
  }

  revalidateGrant(grantId, existing.slug)
  backWithNote(grantId, `${parsed.values.cycleYear} cycle saved.`)
}

export async function deleteCycleAction(grantId: string, cycleId: string): Promise<void> {
  await assertAdmin()
  const existing = await loadGrant(grantId)
  if (!existing) backWithError(grantId, 'Grant not found.')

  await getDb().delete(grantCycles).where(and(eq(grantCycles.id, cycleId), eq(grantCycles.grantId, grantId)))
  revalidateGrant(grantId, existing.slug)
  backWithNote(grantId, 'Cycle deleted.')
}

// #endregion

// #region requirements

export async function saveRequirementForm(grantId: string, requirementId: string, form: FormData): Promise<void> {
  await assertAdmin()
  const existing = await loadGrant(grantId)
  if (!existing) backWithError(grantId, 'Grant not found.')

  const parsed = parseRequirementFields(form)
  if (parsed.error) backWithError(grantId, parsed.error)

  const db = getDb()
  if (requirementId) {
    await db
      .update(grantRequirements)
      .set(parsed.values)
      .where(and(eq(grantRequirements.id, requirementId), eq(grantRequirements.grantId, grantId)))
  } else {
    await db.insert(grantRequirements).values({ grantId, ...parsed.values })
  }

  revalidateGrant(grantId, existing.slug)
  backWithNote(grantId, 'Requirement saved.')
}

export async function deleteRequirementAction(grantId: string, requirementId: string): Promise<void> {
  await assertAdmin()
  const existing = await loadGrant(grantId)
  if (!existing) backWithError(grantId, 'Grant not found.')

  await getDb()
    .delete(grantRequirements)
    .where(and(eq(grantRequirements.id, requirementId), eq(grantRequirements.grantId, grantId)))
  revalidateGrant(grantId, existing.slug)
  backWithNote(grantId, 'Requirement deleted.')
}

// #endregion

// #region form field map

/**
 * Replace the whole prefill map in one write.
 *
 * Replace-all rather than per-row edits because the editor component owns the
 * ordering and hands back the finished list. Each row is re-validated here
 * through the same parser the rest of the admin uses: a client that skipped its
 * own checks still cannot store a `google_form_entry` row with no entry id,
 * which would hand a team a link that drops their answers.
 */
export async function saveGrantFormFieldMap(
  grantId: string,
  fields: FormFieldRowDraft[],
): Promise<{ error?: string }> {
  await assertAdmin()
  const existing = await loadGrant(grantId)
  if (!existing) return { error: 'Grant not found.' }

  const parsed: Array<ReturnType<typeof parseFormFieldFields>['values']> = []
  for (const [i, row] of fields.entries()) {
    const form = new FormData()
    form.set('fillKind', row.fillKind)
    form.set('paramName', row.paramName ?? '')
    form.set('profilePath', row.profilePath ?? '')
    form.set('label', row.label ?? '')
    form.set('notes', row.notes ?? '')
    form.set('sortOrder', String(row.sortOrder ?? i))
    const result = parseFormFieldFields(form)
    if (result.error) return { error: `Row ${i + 1}: ${result.error}` }
    parsed.push(result.values)
  }

  const db = getDb()
  await db.delete(grantFormFields).where(eq(grantFormFields.grantId, grantId))
  if (parsed.length > 0) {
    await db.insert(grantFormFields).values(parsed.map((v) => ({ grantId, ...v })))
  }

  revalidateGrant(grantId, existing.slug)
  return {}
}

/**
 * Point the grant at the form URL recovered from a pasted pre-filled link.
 * Split out from saveGrantForm so the field-map editor can fix the usual cause
 * of a broken prefill without making the admin scroll back up and re-save the
 * whole listing.
 */
export async function saveGrantApplicationUrl(grantId: string, url: string): Promise<{ error?: string }> {
  await assertAdmin()
  const existing = await loadGrant(grantId)
  if (!existing) return { error: 'Grant not found.' }
  const clean = url.trim()
  if (!/^https?:\/\//i.test(clean)) return { error: 'Application URL must start with http:// or https://' }

  await getDb().update(grants).set({ applicationUrl: clean, updatedAt: new Date() }).where(eq(grants.id, grantId))
  revalidateGrant(grantId, existing.slug)
  return {}
}

// #endregion
