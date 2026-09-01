'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq, or } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { grantCandidates, grantCycles, grants } from '@the-tool-pit/db'
import {
  adminIdentity,
  bumpSourceCounter,
  parseCycleFields,
  parseGrantFields,
  resolveFunderByName,
  revalidateGrantPublic,
  uniqueGrantSlug,
} from '@/lib/admin/grants'
import { notifyGrantPublished, notifyGrantCandidateRejected } from '@/lib/notify/approvals'

const QUEUE_PATH = '/admin/grants/candidates'

/**
 * Candidate moderation. Nothing a crawler found reaches the public list except
 * through publishGrantCandidate() below, and that runs off a form a human has
 * just read and corrected. The other three actions are the ways of saying no.
 */

/** Look a grant up by uuid or slug. Admins paste either. */
async function findGrant(ref: string) {
  const clean = ref.trim().toLowerCase()
  if (!clean) return null
  const db = getDb()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(clean)
  const [row] = await db
    .select({ id: grants.id, slug: grants.slug, name: grants.name })
    .from(grants)
    .where(isUuid ? or(eq(grants.id, clean), eq(grants.slug, clean)) : eq(grants.slug, clean))
    .limit(1)
  return row ?? null
}

async function loadCandidate(candidateId: string) {
  const db = getDb()
  const [row] = await db.select().from(grantCandidates).where(eq(grantCandidates.id, candidateId)).limit(1)
  return row ?? null
}

/**
 * Publish a candidate as a new grant, from the corrected editor form.
 *
 * The classification only ever supplies the DEFAULTS on that form. What gets
 * written is what the admin submitted, and the grant is stamped verifiedAt /
 * verifiedBy because a person has just checked these facts against the funder's
 * page. That stamp is what the public "verified on" line reads.
 */
export async function publishGrantCandidate(
  candidateId: string,
  form: FormData,
): Promise<{ error?: string; slug?: string }> {
  await assertAdmin()
  const db = getDb()

  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }
  if (candidate.matchedGrantId) return { error: 'This candidate is already attached to a grant.' }

  const parsed = parseGrantFields(form)
  if (parsed.error) return { error: parsed.error }

  const who = await adminIdentity()
  const now = new Date()
  const slug = await uniqueGrantSlug(parsed.values.name!)
  const funderId = parsed.funderName ? await resolveFunderByName(parsed.funderName) : null
  const status = parsed.values.status ?? 'pending'

  const [created] = await db
    .insert(grants)
    .values({
      ...parsed.values,
      name: parsed.values.name!,
      infoUrl: parsed.values.infoUrl!,
      slug,
      funderId,
      // Provenance: the discovery angle that found it, not the moderator.
      source: candidate.sourceId ? 'web_search' : 'admin',
      verifiedAt: now,
      verifiedBy: who,
      publishedAt: status === 'published' ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: grants.id, slug: grants.slug })

  // An opening cycle is optional. A grant with no confirmed dates is still
  // worth listing; an invented date is not, so the cycle is only written when
  // the admin actually filled the year in.
  if (String(form.get('cycleYear') ?? '').trim()) {
    const cycle = parseCycleFields(form)
    if (cycle.error) {
      // The grant is already in, so fail loudly rather than rolling back and
      // making the admin retype the whole listing.
      revalidatePath(QUEUE_PATH)
      return { error: `Grant saved, but the cycle was not: ${cycle.error}. Add it in the editor.`, slug: created.slug }
    }
    await db.insert(grantCycles).values({
      grantId: created.id,
      ...cycle.values,
      verifiedAt: now,
      verifiedBy: who,
    })
  }

  await db
    .update(grantCandidates)
    .set({ status: 'published', matchedGrantId: created.id, rejectionReason: null, updatedAt: now })
    .where(eq(grantCandidates.id, candidateId))
  await bumpSourceCounter(candidate.sourceId, 'yield')

  // The name that goes in the email is the one on the LISTING, not the one that
  // was submitted: a moderator has just read the funder's page and corrected
  // the form, so telling the submitter what they typed would be telling them
  // something that is no longer true.
  await notifyGrantPublished(candidateId, {
    name: parsed.values.name!,
    slug: created.slug,
    funderName: parsed.funderName ?? null,
  })

  revalidatePath(QUEUE_PATH)
  revalidatePath('/admin/grants')
  revalidateGrantPublic(created.slug)
  return { slug: created.slug }
}

/**
 * Attach a candidate to a grant that is already listed. Used when the crawler
 * found a second page for a grant we know about, e.g. the funder's news post
 * about a programme whose application page is already published. The candidate
 * becomes evidence, not a listing.
 */
export async function attachGrantCandidate(candidateId: string, grantRef: string): Promise<{ error?: string }> {
  await assertAdmin()
  const grant = await findGrant(grantRef)
  if (!grant) return { error: `No grant found for "${grantRef}". Paste its slug or id.` }

  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  await getDb()
    .update(grantCandidates)
    .set({ status: 'matched', matchedGrantId: grant.id, rejectionReason: null, updatedAt: new Date() })
    .where(eq(grantCandidates.id, candidateId))
  // Attaching still counts as a useful find for the source that produced it.
  await bumpSourceCounter(candidate.sourceId, 'yield')

  revalidatePath(QUEUE_PATH)
  return {}
}

/**
 * Suppress with a reason. The reason is not decoration: it is how a source that
 * keeps producing award announcements gets recognised and switched off, and it
 * is also what the person who sent the grant in is told.
 *
 * Double duty, like every other suppress on the site. A candidate at
 * 'published' has a grant in the directory teams are reading, so suppressing it
 * is a takedown and gets the takedown email, not the "we did not list it" one.
 */
export async function suppressGrantCandidate(candidateId: string, reason: string): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = reason.trim()
  if (!clean) return { error: 'Give a reason, even a short one.' }

  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  await getDb()
    .update(grantCandidates)
    .set({ status: 'suppressed', rejectionReason: clean, updatedAt: new Date() })
    .where(eq(grantCandidates.id, candidateId))
  await bumpSourceCounter(candidate.sourceId, 'reject')
  await notifyGrantCandidateRejected(candidateId, candidate.status === 'published', clean)

  revalidatePath(QUEUE_PATH)
  return {}
}

/**
 * Mark a candidate as a duplicate of something already in the queue or listed.
 * Separate from suppression so the reject tally stays a measure of source
 * NOISE: a source that finds the same real grant twice is not a bad source.
 */
export async function markGrantCandidateDuplicate(candidateId: string, grantRef: string): Promise<{ error?: string }> {
  await assertAdmin()
  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  let matchedGrantId: string | null = candidate.matchedGrantId
  let note = 'Duplicate'
  if (grantRef.trim()) {
    const grant = await findGrant(grantRef)
    if (!grant) return { error: `No grant found for "${grantRef}". Leave it blank if it duplicates another candidate.` }
    matchedGrantId = grant.id
    note = `Duplicate of ${grant.slug}`
  }

  await getDb()
    .update(grantCandidates)
    .set({ status: 'duplicate', matchedGrantId, rejectionReason: note, updatedAt: new Date() })
    .where(eq(grantCandidates.id, candidateId))

  revalidatePath(QUEUE_PATH)
  return {}
}

/** Put a candidate back in the pending queue after a wrong call. */
export async function reopenGrantCandidate(candidateId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }
  if (candidate.status === 'published') {
    return { error: 'This one is published. Unpublish the grant in the editor first.' }
  }

  await getDb()
    .update(grantCandidates)
    .set({ status: 'pending', rejectionReason: null, matchedGrantId: null, updatedAt: new Date() })
    .where(eq(grantCandidates.id, candidateId))

  revalidatePath(QUEUE_PATH)
  return {}
}

/**
 * Form-action wrapper for the publish editor: it lives on its own page, so on
 * success it redirects into the new grant's editor rather than returning.
 */
export async function publishGrantCandidateForm(candidateId: string, form: FormData): Promise<void> {
  const res = await publishGrantCandidate(candidateId, form)
  if (res.error) {
    redirect(`${QUEUE_PATH}/${candidateId}?error=${encodeURIComponent(res.error)}`)
  }
  redirect(`/admin/grants?published=${encodeURIComponent(res.slug ?? '')}`)
}
