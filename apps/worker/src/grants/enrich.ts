/**
 * Grant candidate jobs. Two of them, and they answer different questions.
 *
 * processGrantEnrichJob   - load one candidate, run the free junk gate, run
 *                           the classifier, write the verdict back. Is this a
 *                           grant.
 * processGrantExtractJob  - run the second pass over a candidate the
 *                           classifier already accepted, and fill in the
 *                           record. What does the page say.
 *
 * They are separate calls on purpose. A classifier that also extracts is a
 * classifier that invents a deadline to fill a field. See ./candidate-extract.ts.
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
 *
 * The page-shape gate that runs after it is NOT an exception. It writes a
 * classification and stops there, exactly like the model would have, and the
 * candidate still reaches a human on 'pending'.
 */
import { getDb, grantCandidates, eq } from '@the-tool-pit/db'
import type { GrantCandidate, RawGrantMetadata } from '@the-tool-pit/db'
import { politeFetch } from '../connectors/base.js'
import { stripToMainContent } from './strip.js'
import {
  classifyGrantCandidate,
  detectGrantJunkPage,
  detectGrantPageShape,
  shapeClassification,
  GrantClassifierUnavailable,
} from './classify.js'
import {
  extractGrantCandidate,
  shouldExtractCandidate,
  GrantExtractorUnavailable,
  type GrantEvidence,
} from './candidate-extract.js'
import { braveSearch, BraveBudgetExhausted } from './brave.js'
import {
  loadSuppressionExamples,
  pickSuppressionExamples,
  type SuppressionExample,
} from './suppression-feedback.js'

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

/**
 * What the caller does next. The classification decides whether reading the
 * page in full is worth paying for, and the queue handles live in index.ts, so
 * the verdict is returned rather than acted on here.
 */
export interface GrantEnrichOutcome {
  /** True when this candidate is an applicable grant worth extracting. */
  extract: boolean
}

export async function processGrantEnrichJob(payload: GrantEnrichPayload): Promise<GrantEnrichOutcome> {
  const db = getDb()
  const { candidateId } = payload

  const [candidate] = await db
    .select()
    .from(grantCandidates)
    .where(eq(grantCandidates.id, candidateId))
    .limit(1)

  if (!candidate) {
    console.warn(`[grant-enrich] candidate ${candidateId} not found`)
    return { extract: false }
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
    return { extract: false }
  }

  // 2. Deterministic page-shape gate. Also free, and it answers the two
  //    questions the URL already settles: a path ending /grants or /team-grants
  //    is an index to crawl, and a legislature, a caucus press office or a
  //    /news-release/ path is not somewhere a team applies. 13 of the first 89
  //    "applicable grants" were one of those two, and none of them needed a
  //    paid call to be recognised.
  //
  //    Unlike the junk gate this does NOT suppress. It writes the verdict and
  //    leaves the row pending, so a human still routes the aggregator to
  //    grant_sources, or publishes it anyway if the shape guard was wrong.
  const shape = detectGrantPageShape(url)
  if (shape) {
    const shaped = shapeClassification(shape)
    await db
      .update(grantCandidates)
      .set({
        classification: shaped,
        confidenceScore: 0,
        status: 'pending',
        rejectionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(grantCandidates.id, candidateId))
    console.log(
      `[grant-enrich] ${candidateId} decided by shape gate (${shape.shape}), no model call: ${url}`,
    )
    return { extract: false }
  }

  // 3. One model call, carrying what a human rejected recently.
  //
  //    Ranked against this page, so a candidate on a site whose last four
  //    pages were press releases is told that. A suppression that only exists
  //    as free text on a row teaches nothing, and the queue kept serving the
  //    same shapes back for a hand rejection. Failing to load them is not
  //    worth failing the job over: the classifier works without them.
  let negatives: SuppressionExample[] = []
  try {
    negatives = pickSuppressionExamples(await loadSuppressionExamples(), {
      url,
      discoveredVia: meta.discoveredVia,
    })
  } catch (err) {
    console.warn(`[grant-enrich] could not load suppression examples: ${String(err)}`)
  }

  let classification
  try {
    classification = await classifyGrantCandidate(candidate, negatives)
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
      return { extract: false }
    }
    // Transient API and network faults fall through to BullMQ's retry.
    throw err
  }

  // 4. Write the verdict. Status is 'pending' either way: a rejected candidate
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

  return { extract: shouldExtractCandidate({ classification }) }
}

// #region extraction job

/**
 * Payload for the grant-extract queue.
 *
 * `deep` is what the review deck's "flag for more or bad information" button
 * sends. A shallow pass re-reads the text we already have; a deep pass refetches
 * the funder's page, follows the application link, and looks at other surfaces
 * for the same grant. Re-reading the one page that already failed is not a
 * second look.
 */
export interface GrantExtractPayload {
  candidateId: string
  deep?: boolean
  /** What the moderator said was wrong, passed through to the model. */
  reviewNote?: string | null
}

/** Third-party surfaces to consult in a deep pass. One paid query, no more. */
const DEEP_SEARCH_RESULTS = 4

/**
 * Text read off a page in a deep pass, and which evidence bucket it belongs in.
 *
 * A page on the funder's own host, or the form it sends applicants to, is
 * funder_page evidence: it is the funder speaking. Anything else is somebody's
 * summary, which is what the aggregator bucket means.
 */
interface GatheredEvidence {
  evidence: GrantEvidence
  urls: string[]
  notes: string[]
}

function sameSite(a: string, b: string): boolean {
  try {
    const hostA = new URL(a).hostname.replace(/^www\./, '').toLowerCase()
    const hostB = new URL(b).hostname.replace(/^www\./, '').toLowerCase()
    return hostA === hostB || hostA.endsWith(`.${hostB}`) || hostB.endsWith(`.${hostA}`)
  } catch {
    return false
  }
}

/**
 * Collect what the extractor gets to read.
 *
 * The blurb bucket is the reason this is not just `meta.contentText`. Pages
 * like grantexec and instrumentl employ people to write a paragraph about a
 * grant, and that paragraph is often a clearer read on eligibility than the
 * funder's own prose. It arrives on raw_metadata.description for every
 * candidate we have. It goes in as a SEPARATE labelled text, never concatenated
 * into the page, so the model can say which one it quoted and a moderator can
 * see whether a deadline is first hand.
 */
async function gatherEvidence(
  candidate: GrantCandidate,
  meta: RawGrantMetadata,
  deep: boolean,
): Promise<GatheredEvidence> {
  const url = candidate.canonicalUrl ?? candidate.sourceUrl
  const notes: string[] = []
  const urls: string[] = []

  let funderPage = meta.contentText ?? ''
  if (deep || !funderPage.trim()) {
    const fresh = await fetchCandidateText(url)
    if (fresh) {
      funderPage = fresh
      urls.push(url)
    } else {
      notes.push(`could not refetch ${url}, using the text already on the candidate`)
    }
  } else {
    urls.push(url)
  }

  // The blurb someone else wrote. Both descriptions, because og:description is
  // sometimes the fuller one and they are rarely the same sentence.
  const blurbs = [meta.description, meta.ogDescription]
    .filter((s): s is string => Boolean(s && s.trim()))
    .filter((s, i, all) => all.indexOf(s) === i)
  let aggregator = blurbs.join('\n\n')

  if (deep) {
    // 1. The application link, when the page names one. A funder's own form is
    //    where the deadline and the eligibility usually live in full.
    const applicationUrl = meta.applicationUrl ?? candidate.extraction?.fields.applicationUrl.value ?? null
    if (applicationUrl && applicationUrl !== url) {
      const applicationText = await fetchCandidateText(applicationUrl)
      if (applicationText) {
        // First-hand either way. An off-site portal (a Google Form, Submittable)
        // is still where the funder sends applicants, so it joins the page text
        // rather than the bucket for other people's summaries.
        urls.push(applicationUrl)
        funderPage = `${funderPage}\n\n${applicationText}`
      } else {
        notes.push(`application link ${applicationUrl} could not be read`)
      }
    }

    // 2. Other surfaces. One paid Brave query, and only the descriptions:
    //    fetching four more pages to read them is a lot of somebody else's
    //    bandwidth for a paragraph each. The budget guard is brave.ts's.
    const name = candidate.classification?.name ?? meta.title ?? ''
    const funder = candidate.classification?.funderName ?? meta.funderName ?? ''
    if (name) {
      try {
        const results = await braveSearch(`${name} ${funder} grant application deadline eligibility`.trim(), {
          count: 10,
        })
        const extra = results
          .filter((r) => !sameSite(r.url, url))
          .slice(0, DEEP_SEARCH_RESULTS)
          .filter((r) => r.description.trim())
        for (const result of extra) {
          urls.push(result.url)
          aggregator = `${aggregator}\n\n${result.description.trim()}`
        }
        if (extra.length === 0) notes.push('deep search found no other surface describing this grant')
      } catch (err) {
        if (err instanceof BraveBudgetExhausted) {
          notes.push('Brave monthly budget exhausted, other surfaces not searched')
        } else {
          notes.push(`deep search failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } else {
      notes.push('no grant name to search other surfaces with')
    }
  }

  return { evidence: { funderPage, aggregator }, urls, notes }
}

/**
 * Fill in one candidate's record.
 *
 * Runs only on candidates the classifier accepted. Writes the extraction to the
 * candidate and NOTHING else: no grant, no cycle, no requirement, no status
 * change. The human gate on grants is unchanged, and this pass exists to make
 * that gate cheap to pass through, not to bypass it.
 */
export async function processGrantExtractJob(payload: GrantExtractPayload): Promise<void> {
  const db = getDb()
  const { candidateId, deep = false } = payload

  const [candidate] = await db
    .select()
    .from(grantCandidates)
    .where(eq(grantCandidates.id, candidateId))
    .limit(1)

  if (!candidate) {
    console.warn(`[grant-extract] candidate ${candidateId} not found`)
    return
  }
  if (!shouldExtractCandidate(candidate)) {
    // Not a refusal to work, a refusal to spend: an aggregator is a source to
    // crawl and an announcement is a page about a grant. Neither becomes a
    // listing, so neither is worth a call.
    console.log(`[grant-extract] ${candidateId} skipped, the classifier did not accept it as a grant`)
    return
  }

  const meta = (candidate.rawMetadata ?? {}) as RawGrantMetadata
  const url = candidate.canonicalUrl ?? candidate.sourceUrl
  const gathered = await gatherEvidence(candidate, meta, deep)

  if (!gathered.evidence.funderPage.trim() && !gathered.evidence.aggregator.trim()) {
    // Nothing to read is not the same as nothing to say. Leave extraction null
    // so the row is findable by a later pass instead of storing an empty record
    // that reads like a page with nothing on it.
    console.warn(`[grant-extract] ${candidateId} has no text to read (${url}), left unextracted`)
    return
  }

  let extraction
  try {
    extraction = await extractGrantCandidate({
      url,
      classification: candidate.classification,
      evidence: gathered.evidence,
      evidenceUrls: gathered.urls,
      depth: deep ? 'deep' : 'shallow',
      reviewNote: payload.reviewNote ?? candidate.reviewNote,
    })
  } catch (err) {
    if (err instanceof GrantExtractorUnavailable) {
      // Same rule as the classifier: no extraction is a state, not a fake one.
      console.error(`[grant-extract] ${candidateId} left unextracted (${err.kind}): ${err.message}`)
      return
    }
    throw err
  }

  extraction.notes = [...gathered.notes, ...extraction.notes]

  await db
    .update(grantCandidates)
    .set({ extraction, extractedAt: new Date(), updatedAt: new Date() })
    .where(eq(grantCandidates.id, candidateId))

  const filled = Object.values(extraction.fields).filter(
    (field) => field.value !== null && field.value !== 'unknown',
  ).length
  console.log(
    `[grant-extract] ${candidateId} extracted ${filled}/${Object.keys(extraction.fields).length} fields ` +
      `(${extraction.depth}, ${gathered.urls.length} page${gathered.urls.length === 1 ? '' : 's'} read): ${url}`,
  )
}

// #endregion
