/**
 * Auto-publish: ask the site to publish a grant candidate the pipeline has
 * fully verified, instead of waiting for a person to press Publish.
 *
 * Big crawls file 300-400 candidates at a time, and a review pass was spending
 * its time pressing Publish on rows the gate would pass anyway. This file
 * decides whether a candidate is worth ASKING about, and then asks. It does not
 * publish anything itself and it cannot get past the gate: the request goes to
 * /api/internal/queue-decisions, which runs publishCandidateFromForm with
 * publishBlockers and duplicateOfExisting, the same code the review deck runs.
 * overrideVerification is never sent. The bar is the gate, unchanged.
 *
 * shouldAutoPublish is a pre-check, deliberately a little stricter than the
 * gate (a confidence floor, a classifier acceptance), so a request is only
 * sent for a row that has a real chance. When the gate still says no, the
 * refusal is written to the row verbatim and the row is flagged, so the admin
 * queue shows exactly why it is waiting.
 */
import { getDb, grantCandidates, eq, and } from '@the-tool-pit/db'
import type { GrantCandidate } from '@the-tool-pit/db'
import { askSiteToPublishGrant, type GrantPublishResult } from '../site/queue-decisions.js'
import { dedupeCandidateAtIntake } from './intake-dedupe.js'

/** Classifier confidence a crawled candidate needs. A flagged row is exempt. */
export const AUTO_PUBLISH_CONFIDENCE = 0.8

const FIT_LEVELS = new Set(['robotics', 'stem', 'general'])
const OPEN_ROUTES = new Set(['portal', 'form', 'email'])

export type AutoPublishCandidate = Pick<
  GrantCandidate,
  'status' | 'matchedGrantId' | 'classification' | 'extraction' | 'confidenceScore'
>

export type AutoPublishDecision = { ok: true } | { ok: false; reason: string }

// #region pure

export function shouldAutoPublish(candidate: AutoPublishCandidate): AutoPublishDecision {
  const flagged = candidate.status === 'flagged'
  if (candidate.status !== 'pending' && !flagged) return { ok: false, reason: `status is ${candidate.status}` }
  if (candidate.matchedGrantId) return { ok: false, reason: 'already attached to a grant' }

  // A flag is a person saying "this is a grant", which overrules the
  // classifier's verdict. A pending row needs the classifier's own yes.
  if (!flagged) {
    const cls = candidate.classification
    if (!cls) return { ok: false, reason: 'not classified' }
    if (cls.isGrant !== true) return { ok: false, reason: 'classifier did not accept it as a grant' }
    if (cls.isAggregator === true) return { ok: false, reason: 'classifier called it a list page' }
    if (cls.isAnnouncement === true) return { ok: false, reason: 'classifier called it an announcement' }
    const confidence = cls.confidence ?? candidate.confidenceScore ?? 0
    if (confidence < AUTO_PUBLISH_CONFIDENCE) {
      return { ok: false, reason: `classifier confidence ${confidence.toFixed(2)} is below ${AUTO_PUBLISH_CONFIDENCE}` }
    }
  }

  const extraction = candidate.extraction
  if (!extraction) return { ok: false, reason: 'no extraction' }
  const fit = extraction.fit?.level
  if (!fit) return { ok: false, reason: 'no fit verdict' }
  if (!FIT_LEVELS.has(fit)) return { ok: false, reason: `fit is ${fit}` }

  const route = extraction.applyRoute
  if (!route) return { ok: false, reason: 'apply route not verified' }
  if (route.status === 'closed') {
    const proof = extraction.deadlineProof?.kind ?? 'none'
    if (proof === 'none') return { ok: false, reason: 'application closed and no timing on record' }
  } else if (!OPEN_ROUTES.has(route.status)) {
    return { ok: false, reason: `apply route is ${route.status}` }
  }
  return { ok: true }
}

export const AUTO_PUBLISH_NOTE_PREFIX = 'Auto-publish blocked: '

/**
 * The review note after a refusal. A pending row gets the refusal as its note.
 * A flagged row keeps the person's note and gets the refusal appended, once:
 * the backlog script and a later re-extraction must not stack the same line.
 */
export function blockedReviewNote(status: string, existing: string | null | undefined, error: string): string {
  const line = `${AUTO_PUBLISH_NOTE_PREFIX}${error}`
  const kept = status === 'flagged' ? (existing ?? '').trim() : ''
  if (!kept) return line
  if (kept.split('\n').includes(line)) return kept
  return `${kept}\n${line}`
}

// #endregion

export type AutoPublishOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'duplicate'; reason: string }
  | { kind: 'published'; slug: string }
  | { kind: 'published_no_cycle'; slug: string; error: string }
  | { kind: 'blocked'; error: string }
  | { kind: 'unavailable'; error: string }

type LoadedCandidate = AutoPublishCandidate &
  Pick<GrantCandidate, 'id' | 'canonicalUrl' | 'sourceUrl' | 'rawMetadata' | 'reviewNote' | 'createdAt'>

/**
 * Run the decision on one candidate and act on it. Every outcome is logged with
 * [grant-autopublish]. Never throws for a refusal; a database fault throws.
 */
export async function autoPublishCandidate(candidate: LoadedCandidate): Promise<AutoPublishOutcome> {
  const tag = `[grant-autopublish] ${candidate.id}`
  const decision = shouldAutoPublish(candidate)
  if (!decision.ok) {
    console.log(`${tag} skipped: ${decision.reason}`)
    return { kind: 'skipped', reason: decision.reason }
  }

  // The extraction can move the candidate to a different page (an entrance URL
  // swapped for the programme page) and name it properly, so the intake check
  // runs again on what the extraction found. A hit is a duplicate, not a
  // refusal to flag.
  const dup = await dedupeCandidateAtIntake(candidate)
  if (dup.duplicate) {
    console.log(`${tag} not published, marked duplicate: ${dup.reason}`)
    return { kind: 'duplicate', reason: dup.reason }
  }

  const result: GrantPublishResult = await askSiteToPublishGrant(candidate.id, 'auto')
  switch (result.status) {
    case 'published':
      console.log(`${tag} published as /grants/${result.slug}`)
      return { kind: 'published', slug: result.slug }
    case 'published_no_cycle':
      console.warn(`${tag} published as /grants/${result.slug}, cycle refused: ${result.error}`)
      return { kind: 'published_no_cycle', slug: result.slug, error: result.error }
    case 'unavailable':
      // Not a verdict on the candidate, so nothing is written to it. The next
      // extraction or the backlog script asks again.
      console.error(`${tag} could not ask the site: ${result.error}`)
      return { kind: 'unavailable', error: result.error }
    case 'refused': {
      await getDb()
        .update(grantCandidates)
        .set({
          status: 'flagged',
          reviewNote: blockedReviewNote(candidate.status, candidate.reviewNote, result.error),
          updatedAt: new Date(),
        })
        // Only the state we read: a person's decision in the meantime stands.
        .where(and(eq(grantCandidates.id, candidate.id), eq(grantCandidates.status, candidate.status)))
      console.log(`${tag} blocked by the publish gate, flagged: ${result.error}`)
      return { kind: 'blocked', error: result.error }
    }
  }
}

/** Load one candidate by id and run autoPublishCandidate on it. */
export async function autoPublishCandidateById(candidateId: string): Promise<AutoPublishOutcome> {
  const [candidate] = await getDb().select().from(grantCandidates).where(eq(grantCandidates.id, candidateId)).limit(1)
  if (!candidate) {
    console.warn(`[grant-autopublish] ${candidateId} not found`)
    return { kind: 'skipped', reason: 'not found' }
  }
  return autoPublishCandidate(candidate)
}
