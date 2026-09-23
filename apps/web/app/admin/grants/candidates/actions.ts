'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { grantCandidates } from '@the-tool-pit/db'
import { adminIdentity, revalidateGrantPublic } from '@/lib/admin/grants'
import { loadCandidate, publishCandidateFromForm } from '@/lib/admin/grant-publish'
import {
  attachGrantCandidateBody,
  flagGrantCandidateBody,
  markGrantCandidateDuplicateBody,
  routeGrantCandidateToSourceBody,
  suppressGrantCandidateBody,
} from '@/lib/admin/grant-decisions'

const QUEUE_PATH = '/admin/grants/candidates'

/**
 * Candidate moderation. Nothing a crawler found reaches the public list except
 * through publishGrantCandidate() below, and that runs off a form a human has
 * just read and corrected. The other three actions are the ways of saying no.
 */


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
  const who = await adminIdentity()
  const out = await publishCandidateFromForm(candidateId, form, who)
  if (out.error) return { error: out.error }
  revalidatePath(QUEUE_PATH)
  if (out.cycleError) {
    return { error: `Grant saved, but the cycle was not: ${out.cycleError}. Add it in the editor.`, slug: out.slug }
  }
  revalidatePath('/admin/grants')
  revalidateGrantPublic(out.slug!)
  return { slug: out.slug }
}

/** Attach a candidate to a grant already listed. Body in lib/admin/grant-decisions.ts. */
export async function attachGrantCandidate(candidateId: string, grantRef: string): Promise<{ error?: string }> {
  await assertAdmin()
  const out = await attachGrantCandidateBody(candidateId, grantRef)
  if (out.error) return out
  revalidatePath(QUEUE_PATH)
  return {}
}

/** Turn an aggregator into a disabled crawl source. Body in lib/admin/grant-decisions.ts. */
export async function routeGrantCandidateToSource(candidateId: string): Promise<{ error?: string; label?: string }> {
  await assertAdmin()
  const out = await routeGrantCandidateToSourceBody(candidateId, await adminIdentity())
  if (out.error) return out
  revalidatePath(QUEUE_PATH)
  revalidatePath('/admin/grants/sources')
  return out
}

/** Suppress with a reason (a takedown when published). Body in lib/admin/grant-decisions.ts. */
export async function suppressGrantCandidate(
  candidateId: string,
  reason: string,
  kind?: string,
): Promise<{ error?: string }> {
  await assertAdmin()
  const out = await suppressGrantCandidateBody(candidateId, reason, kind)
  if (out.error) return out
  revalidatePath(QUEUE_PATH)
  return {}
}

/** Flag for a deep re-extract, not a rejection. Body in lib/admin/grant-decisions.ts. */
export async function flagGrantCandidate(candidateId: string, note: string): Promise<{ error?: string; queued?: boolean }> {
  await assertAdmin()
  const out = await flagGrantCandidateBody(candidateId, note)
  if (out.error) return out
  revalidatePath(QUEUE_PATH)
  return out
}

/** Mark as a duplicate, not noise. Body in lib/admin/grant-decisions.ts. */
export async function markGrantCandidateDuplicate(candidateId: string, grantRef: string): Promise<{ error?: string }> {
  await assertAdmin()
  const out = await markGrantCandidateDuplicateBody(candidateId, grantRef)
  if (out.error) return out
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
    .set({
      status: 'pending',
      rejectionReason: null,
      rejectionKind: null,
      reviewNote: null,
      matchedGrantId: null,
      updatedAt: new Date(),
    })
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
  // The deck posts the next candidate's id with the form, so approving one
  // lands on the next one to read rather than back on a list to re-find your
  // place in. An empty box means that was the last row.
  const next = String(form.get('nextCandidateId') ?? '').trim()
  if (next) redirect(`${QUEUE_PATH}/${next}`)
  redirect(`/admin/grants?published=${encodeURIComponent(res.slug ?? '')}`)
}
