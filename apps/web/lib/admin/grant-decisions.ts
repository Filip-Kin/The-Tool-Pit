import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { grantCandidates, grantSources } from '@the-tool-pit/db'
import { GRANT_REJECTION_KINDS, type GrantRejectionKind } from '@the-tool-pit/db'
import { enqueueGrantExtract } from '@/lib/admin/grant-queue'
import { bumpSourceCounter } from '@/lib/admin/grants'
import { notifyGrantCandidateRejected } from '@/lib/notify/approvals'
import { findGrant, loadCandidate } from '@/lib/admin/grant-publish'

/**
 * Grant candidate decisions other than publish (publish is
 * publishCandidateFromForm in grant-publish.ts). One body each, shared by the
 * admin buttons in app/admin/grants/candidates/actions.ts and by
 * /api/internal/queue-decisions. The callers own auth and cache revalidation;
 * every other side effect (source counters, emails, the re-extract queue) is
 * here so both callers get it.
 *
 * `who` is the display name for the audit lines that take one. The admin
 * action passes adminIdentity().
 */

// #region attach

/**
 * Attach a candidate to a grant that is already listed. Used when the crawler
 * found a second page for a grant we know about, e.g. the funder's news post
 * about a programme whose application page is already published. The candidate
 * becomes evidence, not a listing.
 */
export async function attachGrantCandidateBody(candidateId: string, grantRef: string): Promise<{ error?: string }> {
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
  return {}
}

// #endregion

// #region route to source

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
 * page was a good find, so this bumps yield, the same call attach makes.
 */
export async function routeGrantCandidateToSourceBody(
  candidateId: string,
  who: string,
): Promise<{ error?: string; label?: string }> {
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
      // GRANT_SOURCE_KINDS. See the note on the Run button in
      // app/admin/grants/sources: no connector answers to 'aggregator' yet, so
      // this row is a confirmed, named target waiting for one rather than
      // something that runs tonight.
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
        `Routed from the candidate queue by ${who}. ` +
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

  console.log(`[grants] candidate ${candidateId} routed to grant_sources ${created.id} (${target})`)
  return { label }
}

// #endregion

// #region suppress

/**
 * Suppress with a reason. The reason is not decoration: it is how a source that
 * keeps producing award announcements gets recognised and switched off, and it
 * is also what the person who sent the grant in is told.
 *
 * Double duty, like every other suppress on the site. A candidate at
 * 'published' has a grant in the directory teams are reading, so suppressing it
 * is a takedown and gets the takedown email, not the "we did not list it" one.
 */
export async function suppressGrantCandidateBody(
  candidateId: string,
  reason: string,
  kind?: string,
): Promise<{ error?: string }> {
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
  return {}
}

// #endregion

// #region flag

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
export async function flagGrantCandidateBody(
  candidateId: string,
  note: string,
): Promise<{ error?: string; queued?: boolean }> {
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
  return { queued }
}

// #endregion

// #region duplicate

/**
 * Mark a candidate as a duplicate of something already in the queue or listed.
 * Separate from suppression so the reject tally stays a measure of source
 * NOISE: a source that finds the same real grant twice is not a bad source.
 */
export async function markGrantCandidateDuplicateBody(candidateId: string, grantRef: string): Promise<{ error?: string }> {
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
  return {}
}

// #endregion
