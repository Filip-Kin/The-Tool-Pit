/**
 * Grant candidate enrich job.
 *
 * Load one candidate, run the free junk gate, run the classifier, write the
 * verdict back. That is the whole job.
 *
 * The asymmetry with the tools pipeline is deliberate, so it is worth stating
 * plainly: ../jobs/enrich.ts publishes a tool by itself once confidence clears
 * 0.7. This job has NO publish threshold and never will. Every classified
 * grant candidate lands on 'pending' for a human, whatever the model said,
 * because a wrong deadline in front of a team that misses a real one is worse
 * than an empty directory. The tools vertical auto-published its crawl output
 * and filled with forum threads and bot walls, and grants exist downstream of
 * that lesson. grants.verifiedAt and grantCycles.verifiedAt are human
 * confirmations, and nothing in this file may set them.
 *
 * The single exception is the deterministic junk gate, which does auto-suppress.
 * That is safe because it never makes a judgement about funding: it only says
 * the fetch returned a bot wall, an error shell or an empty page, and the
 * reason is written to rejectionReason so an admin can see and reverse it.
 */
import { getDb, grantCandidates, eq } from '@the-tool-pit/db'
import type { RawGrantMetadata } from '@the-tool-pit/db'
import { politeFetch } from '../connectors/base.js'
import { stripToMainContent } from './strip.js'
import {
  classifyGrantCandidate,
  detectGrantJunkPage,
  GrantClassifierUnavailable,
} from './classify.js'

/**
 * Payload for the grant-enrich queue. Kept here rather than in
 * @the-tool-pit/types so this vertical can land without touching the shared
 * package, move it if apps/web ever needs to enqueue with a typed payload.
 */
export interface GrantEnrichPayload {
  candidateId: string
}

/**
 * Text the junk gate and the classifier read. Title comes from the crawler's
 * metadata, body is the stripped page text plus the descriptions, so a page
 * with no <body> text but a real meta description is not called empty.
 */
function readableText(meta: RawGrantMetadata): { title: string; body: string } {
  const body = [meta.contentText, meta.description, meta.ogDescription]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join('\n\n')
  return { title: meta.title ?? '', body }
}

/** Content types we can read text out of. Anything else needs a person. */
const READABLE_CONTENT = /^(text\/html|application\/xhtml)/i

/**
 * Longest page text we keep on the candidate. Enough for the classifier to
 * judge a funder page, short enough that a runaway CMS cannot bloat the row.
 */
const CANDIDATE_TEXT_LIMIT = 20_000

/**
 * Read the candidate's own page.
 *
 * No connector does this. A Brave result arrives as a ~150 character search
 * snippet, and that alone used to reach the junk gate, where MIN_CONTENT_CHARS
 * (200) suppressed it as "empty" and the run silently lost a real funder page
 * AND the paid Brave query that found it. Anything that squeaked past 200
 * bought a model call to judge a page nobody had read.
 *
 * So the page is fetched once here, before the gate, and the text is stored on
 * the candidate so a re-run does not fetch it again. A failure is NOT fatal
 * and NOT a suppression: it returns null, the gate is told to go easy, and the
 * candidate still reaches a human.
 */
async function fetchCandidateText(url: string): Promise<string | null> {
  try {
    const res = await politeFetch(url)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType && !READABLE_CONTENT.test(contentType)) return null
    const text = stripToMainContent(await res.text())
    return text.trim() ? text.slice(0, CANDIDATE_TEXT_LIMIT) : null
  } catch {
    // politeFetch aborts at 15s. A timeout, a DNS failure and a TLS error are
    // the same thing here: we did not read the page, so we do not get to call
    // it empty.
    return null
  }
}

export async function processGrantEnrichJob(payload: GrantEnrichPayload): Promise<void> {
  const db = getDb()
  const { candidateId } = payload

  const [candidate] = await db
    .select()
    .from(grantCandidates)
    .where(eq(grantCandidates.id, candidateId))
    .limit(1)

  if (!candidate) {
    console.warn(`[grant-enrich] candidate ${candidateId} not found`)
    return
  }

  const url = candidate.canonicalUrl ?? candidate.sourceUrl
  let meta = (candidate.rawMetadata ?? {}) as RawGrantMetadata

  // 0. Read the page, unless a previous pass already did. Free apart from the
  //    request, and it is what makes both the gate below and the model call
  //    after it judgements about the actual page rather than a search snippet.
  let fetched = false
  if (!meta.contentText?.trim()) {
    const text = await fetchCandidateText(url)
    if (text) {
      meta = { ...meta, contentText: text }
      await db
        .update(grantCandidates)
        .set({ rawMetadata: meta, updatedAt: new Date() })
        .where(eq(grantCandidates.id, candidateId))
      fetched = true
    }
  }

  const { title, body } = readableText(meta)

  // 1. Deterministic junk gate. Free, and it runs before any paid call because
  //    the Anthropic account is pay as you go and has run dry before.
  //
  //    If we never got the page text, the length test is not ours to make: a
  //    short body then means "we could not read it", not "the funder published
  //    an empty page". Suppressing on that would be a machine quietly capping
  //    coverage, which is the one thing this vertical is built not to do, so
  //    an unread candidate goes to a human instead.
  const readThePage = Boolean(meta.contentText?.trim())
  const junkReason = detectGrantJunkPage(title, body, { allowShortBody: !readThePage })
  if (junkReason) {
    await db
      .update(grantCandidates)
      .set({
        status: 'suppressed',
        confidenceScore: 0,
        rejectionReason: junkReason,
        updatedAt: new Date(),
      })
      .where(eq(grantCandidates.id, candidateId))
    console.log(`[grant-enrich] ${candidateId} suppressed by junk gate: ${junkReason} (${url})`)
    return
  }

  // 2. One model call.
  let classification
  try {
    classification = await classifyGrantCandidate(candidate)
  } catch (err) {
    if (err instanceof GrantClassifierUnavailable) {
      // No verdict is a state, not a failure. The row keeps classification=null
      // so the next pass can find it with `classification IS NULL`, and nothing
      // fake is written where a reviewer would read it as a real score. Logged
      // loudly because an exhausted account silently stalling discovery is
      // exactly the kind of invisible cap this vertical refuses to have.
      console.error(
        `[grant-enrich] ${candidateId} left unclassified (${err.kind}): ${err.message}`,
      )
      return
    }
    // Transient API and network faults fall through to BullMQ's retry.
    throw err
  }

  // 3. Write the verdict. Status is 'pending' either way: a rejected candidate
  //    is still shown to a human, who suppresses it and thereby teaches the
  //    source's rejectCount what a noisy source looks like.
  await db
    .update(grantCandidates)
    .set({
      classification,
      confidenceScore: classification.confidence ?? 0,
      status: 'pending',
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(grantCandidates.id, candidateId))

  // A list page is not a listing, it is a source. Log it distinctly so the
  // admin queue can route it to grant_sources instead of to a grant.
  const verdict = classification.isAggregator
    ? 'aggregator (route to a crawl source)'
    : classification.isGrant
      ? 'applicable grant'
      : classification.isAnnouncement
        ? 'announcement or sponsor wall'
        : 'not applicable'

  console.log(
    `[grant-enrich] ${candidateId} pending review: ${verdict}, ` +
      `confidence=${(classification.confidence ?? 0).toFixed(2)}` +
      `${fetched ? ' [page fetched]' : readThePage ? '' : ' [page NOT read]'} (${url})`,
  )
}
