'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq, or } from 'drizzle-orm'
import { assertAdmin } from '@/lib/admin/auth'
import { getDb } from '@/lib/db'
import { grantCandidates, grantCycles, grantRequirements, grants, grantSources } from '@the-tool-pit/db'
import { GRANT_REJECTION_KINDS, type GrantRejectionKind } from '@the-tool-pit/db'
import { reviewRequirements } from '@/lib/admin/grant-review'
import { enqueueGrantExtract } from '@/lib/admin/grant-queue'
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
import { grantGrantOwnership } from '@/lib/listings/submitter-ownership'

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

  // Eligibility the moderator confirmed on the deck. Only 'yes' answers write
  // a rule: a requirement row can rule a team OUT, and "the funder does not
  // require this" is not a rule. The 'no' and 'unknown' answers stay readable
  // on the candidate's extraction, which is where "not stated" belongs.
  const requirements = reviewRequirements(form)
  if (requirements.length > 0) {
    await db.insert(grantRequirements).values(
      requirements.map((r) => ({
        grantId: created.id,
        kind: r.kind,
        operator: r.operator,
        value: r.value,
        label: r.label,
        isBlocking: r.isBlocking,
        sortOrder: r.sortOrder,
      })),
    )
  }

  await db
    .update(grantCandidates)
    .set({
      status: 'published',
      matchedGrantId: created.id,
      rejectionReason: null,
      rejectionKind: null,
      reviewNote: null,
      updatedAt: now,
    })
    .where(eq(grantCandidates.id, candidateId))
  await bumpSourceCounter(candidate.sourceId, 'yield')

  // Same rule as every other vertical: whoever submitted it runs it, unless
  // they ticked "I am only passing this along". A grant a team administers, or
  // a programme officer's own, is a real case and is what this is for.
  await grantGrantOwnership(candidateId, created.id)

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
 * Turn an aggregator into a crawl source.
 *
 * A page that LISTS twenty grants is worth twenty listings, but only if
 * something crawls it, and until now the classifier could say isAggregator and
 * the queue had nowhere to put the answer. 82 of them were sitting in the
 * pending tab as things a reviewer could only publish (wrong) or suppress
 * (throwing the list away). This is the third door.
 *
 * The new row goes in DISABLED, for the same reason grant_seed inserts its nine
 * curated funders disabled: nothing points a crawler at a URL until a human has
 * opened it and confirmed it is the live index. An enabled row created by one
 * click from a queue screen is exactly how a directory fills with the wrong
 * programme.
 *
 * The candidate becomes 'matched' rather than 'suppressed'. Suppression means
 * "this source produced noise", it bumps rejectCount and it emails the person
 * who sent the page in that we did not list it. None of that is true here: the
 * page was a good find, so this bumps yield, the same call attachGrantCandidate
 * makes.
 */
export async function routeGrantCandidateToSource(candidateId: string): Promise<{ error?: string; label?: string }> {
  await assertAdmin()
  const db = getDb()

  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }
  if (candidate.status === 'published') {
    return { error: 'This one is published as a grant. Unpublish it first if it is really a list page.' }
  }

  const target = (candidate.canonicalUrl ?? candidate.sourceUrl).trim()
  let host: string
  try {
    host = new URL(target).hostname.replace(/^www\./, '')
  } catch {
    return { error: `"${target}" is not a URL a crawler can be pointed at.` }
  }

  // Matched on target, the same key grant_seed dedupes its curated list on. A
  // second source row for the same page would double every candidate it finds.
  const [existing] = await db
    .select({ id: grantSources.id, label: grantSources.label, enabled: grantSources.enabled })
    .from(grantSources)
    .where(eq(grantSources.target, target))
    .limit(1)
  if (existing) {
    return {
      error: `Already a source: "${existing.label}"${existing.enabled ? '' : ' (switched off)'}. Nothing was created.`,
    }
  }

  const classification = candidate.classification ?? {}
  const meta = candidate.rawMetadata ?? {}
  // The classifier's name beats the raw <title>, which is usually "Grants |
  // Home". The host is the last resort so the sources screen never shows a
  // blank label.
  const label = (classification.name ?? meta.title ?? host).trim().slice(0, 120) || host

  const [created] = await db
    .insert(grantSources)
    .values({
      // GRANT_SOURCE_KINDS. See the note on the Run button in ../sources: no
      // connector answers to 'aggregator' yet, so this row is a confirmed,
      // named target waiting for one rather than something that runs tonight.
      kind: 'aggregator',
      label,
      target,
      enabled: false,
      // A funder index is republished once a season at most, the same
      // assumption grant_seed makes about a funder's grants page.
      cadenceHours: 168,
      config: {
        funderName: classification.funderName ?? meta.funderName ?? null,
        // Provenance, so the row can be traced back to the page and the verdict
        // that produced it.
        fromCandidateId: candidate.id,
        needsVerification: true,
      },
      notes:
        `Routed from the candidate queue by ${await adminIdentity()}. ` +
        `Classifier said: ${classification.reasoning ?? 'no reasoning recorded'} ` +
        `URL NOT CONFIRMED as the live index. Open it, check it lists several separate grants, then enable.`,
    })
    .returning({ id: grantSources.id })

  await db
    .update(grantCandidates)
    .set({
      status: 'matched',
      // Not a rejection. This column is the only free-text audit line on the
      // row, and leaving it null would make a routed candidate look identical
      // to one attached to a grant.
      rejectionReason: `Routed to grant_sources as an aggregator: "${label}" (created disabled, confirm the URL before enabling)`,
      updatedAt: new Date(),
    })
    .where(eq(grantCandidates.id, candidateId))

  // A list page the crawler found is a good find, so it counts for the source
  // that found it, exactly like an attach does.
  await bumpSourceCounter(candidate.sourceId, 'yield')

  revalidatePath(QUEUE_PATH)
  revalidatePath('/admin/grants/sources')
  console.log(`[grants] candidate ${candidateId} routed to grant_sources ${created.id} (${target})`)
  return { label }
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
export async function suppressGrantCandidate(
  candidateId: string,
  reason: string,
  kind?: string,
): Promise<{ error?: string }> {
  await assertAdmin()
  const clean = reason.trim()
  if (!clean) return { error: 'Give a reason, even a short one.' }

  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }

  // The bucket is the half a machine can read. apps/worker's
  // suppression-feedback.ts turns recent ones into the classifier's negative
  // examples, ranked against the page it is judging, so the same list pages
  // stop coming back to be rejected by hand. An unbucketed suppression still
  // works, it just teaches nothing.
  const rejectionKind = (GRANT_REJECTION_KINDS as readonly string[]).includes(kind ?? '')
    ? (kind as GrantRejectionKind)
    : null

  await getDb()
    .update(grantCandidates)
    .set({ status: 'suppressed', rejectionReason: clean, rejectionKind, updatedAt: new Date() })
    .where(eq(grantCandidates.id, candidateId))
  await bumpSourceCounter(candidate.sourceId, 'reject')
  await notifyGrantCandidateRejected(candidateId, candidate.status === 'published', clean)

  revalidatePath(QUEUE_PATH)
  return {}
}

/**
 * Flag a candidate for better data. The third answer, and NOT a rejection.
 *
 * It means the page probably is a grant and what we read off it is wrong or too
 * thin to publish. So the row stays in the queue with its extraction, nothing
 * is emailed to anybody, the source's reject tally is untouched, and a deep
 * re-extraction is queued: refetch the funder's page, follow the application
 * link, and look at other surfaces for the same grant. Re-reading the one page
 * that already came back thin is not a second look.
 *
 * The moderator's note rides along to the model, so the second pass is told
 * what was wrong the first time instead of finding the same gap again.
 */
export async function flagGrantCandidate(candidateId: string, note: string): Promise<{ error?: string; queued?: boolean }> {
  await assertAdmin()
  const clean = note.trim()
  if (!clean) return { error: 'Say what is wrong or missing. That note is what the re-read is told.' }

  const candidate = await loadCandidate(candidateId)
  if (!candidate) return { error: 'Candidate not found.' }
  if (candidate.status === 'published') {
    return { error: 'This one is published as a grant. Fix it in the grant editor instead.' }
  }

  await getDb()
    .update(grantCandidates)
    .set({ status: 'flagged', reviewNote: clean, rejectionReason: null, updatedAt: new Date() })
    .where(eq(grantCandidates.id, candidateId))

  // A queue that is down must not lose the flag: the row is already marked, so
  // the worst case is a re-read that has to be asked for again.
  const queued = await enqueueGrantExtract({ candidateId, deep: true, reviewNote: clean })

  revalidatePath(QUEUE_PATH)
  return { queued }
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
