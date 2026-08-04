import { eq } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { crawlCandidates, submissions, tools } from '@the-tool-pit/db'
import type { PipelineLogEntry, CandidateClassification } from '@the-tool-pit/db'
import { classifyCandidate } from '../pipeline/classify.js'
import { fetchGitHubRepo } from '../connectors/github.js'
import { publishCandidate } from '../pipeline/publish.js'
import { extractMetadata } from '../pipeline/extract.js'
import type { EnrichJobPayload } from '@the-tool-pit/types'

// #region deterministic junk gate
// Bot walls, error/redirect shells, and maintenance pages that the LLM classifier scores
// unreliably (it has waved a Cloudflare "Client Challenge" page through as a 0.9 tool).
// Anchored at the start of the title and kept conservative to avoid nuking real tools.
const JUNK_TITLE_RE = /^(?:just a moment|attention required|access denied|forbidden|client challenge|are you a robot\??|checking your browser|security check|verify you are human|captcha required|page not found|404 not found|error 4\d\d|site maintenance|under maintenance|temporarily unavailable|you are being redirected)\b/i

const JUNK_BODY_MARKERS = [
  'enable javascript and cookies to continue',
  'checking if the site connection is secure',
  'performance & security by cloudflare',
  'please complete the security check',
  'verify you are human',
]

/** Deterministic detector for non-tool pages. Returns a suppression reason, or null if the page looks real. */
function detectJunkPage(title: string, body: string): string | null {
  const t = title.trim()
  if (JUNK_TITLE_RE.test(t)) return `Non-tool page (title: "${t.slice(0, 60)}")`
  // Body markers only count when the page is also thin — a real tool that merely mentions
  // Cloudflare in a long body should not be caught.
  if (body.length < 600 && JUNK_BODY_MARKERS.some((m) => body.toLowerCase().includes(m))) {
    return 'Bot-challenge / security-check page'
  }
  return null
}

/** Read an integer stashed in a connector keyword like "team:254" / "year:2026". */
function parseKeywordInt(keywords: string[], prefix: string): number | null {
  const kw = keywords.find((k) => k.startsWith(prefix))
  if (!kw) return null
  const n = parseInt(kw.slice(prefix.length), 10)
  return Number.isInteger(n) ? n : null
}
// #endregion

/**
 * When a re-classification decides a candidate should be suppressed, also suppress the
 * tool it was previously linked to (so it disappears from the public directory).
 * Only acts if matchedToolId is set — i.e. this candidate was the one that created the tool.
 */
async function suppressMatchedTool(matchedToolId: string, reason: string): Promise<void> {
  const db = getDb()
  await db
    .update(tools)
    .set({ status: 'suppressed', adminNotes: `Auto-suppressed on re-classification: ${reason}`, updatedAt: new Date() })
    .where(eq(tools.id, matchedToolId))
  console.log(`[enrich] suppressed tool ${matchedToolId}: ${reason}`)
}

/** Updates the originating submission record when a candidate-backed submission resolves. */
async function resolveSubmission(
  submissionId: string,
  status: 'published' | 'needs_review',
  resolvedToolId?: string,
  logMessage?: string,
): Promise<void> {
  const db = getDb()

  if (logMessage) {
    const [sub] = await db
      .select({ pipelineLog: submissions.pipelineLog })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1)
    const existingLog = (sub?.pipelineLog ?? []) as PipelineLogEntry[]
    const newEntry: PipelineLogEntry = { stage: 'enrich', status: 'warn', message: logMessage, timestamp: new Date().toISOString() }
    await db
      .update(submissions)
      .set({
        status,
        resolvedToolId: resolvedToolId ?? null,
        updatedAt: new Date(),
        pipelineLog: [...existingLog, newEntry],
      })
      .where(eq(submissions.id, submissionId))
  } else {
    await db
      .update(submissions)
      .set({ status, resolvedToolId: resolvedToolId ?? null, updatedAt: new Date() })
      .where(eq(submissions.id, submissionId))
  }
}

export async function processEnrichJob(payload: EnrichJobPayload): Promise<void> {
  const db = getDb()
  const { candidateId, submissionId, sourceType } = payload

  const [candidate] = await db
    .select()
    .from(crawlCandidates)
    .where(eq(crawlCandidates.id, candidateId))
    .limit(1)

  if (!candidate) {
    console.warn(`[enrich] candidate ${candidateId} not found`)
    return
  }

  let metadata = (candidate.rawMetadata ?? {}) as Record<string, unknown>
  const url = candidate.canonicalUrl ?? candidate.sourceUrl

  // When rescrape=true (e.g. triggered from admin "re-enrich") re-fetch the page so we
  // pick up rawHtml and any content changes since the candidate was first created.
  if (payload.rescrape) {
    const fresh = await extractMetadata(url)
    // Merge: fresh values win, but keep any existing fields the scraper didn't return
    metadata = { ...metadata, ...Object.fromEntries(Object.entries(fresh).filter(([, v]) => v !== undefined)) }
    await db
      .update(crawlCandidates)
      .set({ rawMetadata: metadata, rejectionReason: null, confidenceScore: null, classification: null, updatedAt: new Date() })
      .where(eq(crawlCandidates.id, candidateId))
    console.log(`[enrich] candidate ${candidateId}: rescraped ${url}`)
  }

  // 1. GitHub enrichment FIRST — so classification has full context (topics, description, etc.)
  let enrichedMetadata = { ...metadata }
  const githubUrl = metadata.githubUrl as string | undefined
  let githubStars = 0

  if (githubUrl) {
    const repoInfo = await fetchGitHubRepo(githubUrl)
    if (repoInfo) {
      githubStars = repoInfo.stars
      // Backfill title from repo name if missing
      if (!enrichedMetadata.title && repoInfo.fullName) {
        const repoName = repoInfo.fullName.split('/')[1] ?? repoInfo.fullName
        enrichedMetadata.title = repoName.replace(/[-_]/g, ' ')
      }
      if (!enrichedMetadata.description && repoInfo.description) {
        enrichedMetadata.description = repoInfo.description
      }
      if (repoInfo.homepage && !enrichedMetadata.homepageUrl) {
        enrichedMetadata.homepageUrl = repoInfo.homepage
      }
      // Merge topics into keywords for classifier signal
      enrichedMetadata.keywords = [
        ...((enrichedMetadata.keywords as string[]) ?? []),
        ...repoInfo.topics,
      ]
      // Store star count so publishCandidate can write it to the tool record
      enrichedMetadata.githubStars = repoInfo.stars
    }
  }

  // 2. Quality gate — suppress garbage before spending API credits on classification.
  //    Only require a title — many legitimate SPAs serve no meta description server-side.
  //    The AI classifier handles empty descriptions fine and generates its own summary.
  const qualityTitle = (enrichedMetadata.title as string | undefined) ?? ''
  if (qualityTitle.length < 3) {
    const reason = 'Low quality metadata — title missing or too short'
    await db
      .update(crawlCandidates)
      .set({ status: 'suppressed', rejectionReason: reason, updatedAt: new Date() })
      .where(eq(crawlCandidates.id, candidateId))
    console.log(`[enrich] candidate ${candidateId}: suppressed (${reason})`)
    if (submissionId) await resolveSubmission(submissionId, 'needs_review', undefined, reason)
    return
  }

  // 2b. Deterministic junk gate — kill bot walls / error shells before spending API credits.
  const junkReason = detectJunkPage(qualityTitle, (enrichedMetadata.rawHtml as string | undefined) ?? '')
  if (junkReason) {
    await db
      .update(crawlCandidates)
      .set({ status: 'suppressed', confidenceScore: 0, rejectionReason: junkReason, updatedAt: new Date() })
      .where(eq(crawlCandidates.id, candidateId))
    console.log(`[enrich] candidate ${candidateId}: suppressed (${junkReason})`)
    if (candidate.matchedToolId) await suppressMatchedTool(candidate.matchedToolId, junkReason)
    if (submissionId) await resolveSubmission(submissionId, 'needs_review', undefined, junkReason)
    return
  }

  // 2c. Trusted curated CAD source (Spectrum FRC CAD Collection): pre-classify deterministically
  //     as team CAD rather than spending ~900 AI calls, and land it in the Robot Code Archive.
  if (sourceType === 'spectrum_cad') {
    const kws = (enrichedMetadata.keywords as string[] | undefined) ?? []
    const cadClassification: CandidateClassification = {
      toolType: 'resource',
      programs: ['frc'],
      isTeamCad: true,
      teamNumber: parseKeywordInt(kws, 'team:'),
      seasonYear: parseKeywordInt(kws, 'year:'),
      summary: ((enrichedMetadata.description as string | undefined) || (enrichedMetadata.title as string | undefined) || '').slice(0, 300),
      confidence: 0.9,
      reasoning: 'Curated FRC CAD Collection (Spectrum 3847)',
    }
    await db
      .update(crawlCandidates)
      .set({ rawMetadata: enrichedMetadata, classification: cadClassification, confidenceScore: 0.9, status: 'pending', rejectionReason: null, updatedAt: new Date() })
      .where(eq(crawlCandidates.id, candidateId))
    const result = await publishCandidate(candidateId, sourceType)
    console.log(`[enrich] candidate ${candidateId} (spectrum_cad): ${result.action}`)
    return
  }

  // 3. AI classification — now has full enriched context
  const classification = await classifyCandidate(
    enrichedMetadata,
    url,
  )

  // 4a. Hard-reject team websites — no point processing further
  if (classification.isTeamWebsite) {
    const reason = 'Team website — not a reusable tool'
    await db
      .update(crawlCandidates)
      .set({ classification, confidenceScore: 0, status: 'suppressed', rejectionReason: reason, updatedAt: new Date() })
      .where(eq(crawlCandidates.id, candidateId))
    console.log(`[enrich] candidate ${candidateId}: suppressed (${reason})`)
    if (candidate.matchedToolId) await suppressMatchedTool(candidate.matchedToolId, reason)
    if (submissionId) await resolveSubmission(submissionId, 'needs_review', undefined, reason)
    return
  }

  // 4. Program hard-override: GitHub topics / keywords are ground truth for program detection
  if (!classification.programs?.length) {
    const desc = (enrichedMetadata.description as string | undefined) ?? ''
    const haystack = [
      ...(enrichedMetadata.keywords as string[] ?? []),
      qualityTitle,
      desc,
    ].join(' ').toLowerCase()

    const programs: string[] = []
    if (/\bfrc\b|first\s+robotics\s+competition/.test(haystack)) programs.push('frc')
    if (/\bftc\b|first\s+tech\s+challenge/.test(haystack)) programs.push('ftc')
    if (/\bfll\b|first\s+lego\s+league/.test(haystack)) programs.push('fll')
    if (programs.length > 0) classification.programs = programs
  }

  const confidence = classification.confidence ?? 0.3

  // A forum-discovered page must clear a higher bar to become a NEW standalone listing: a
  // Chief Delphi thread should only spawn a tool when the linked thing is clearly a tool.
  // Otherwise it merely attaches as a forum link on an existing tool (handled at crawl dedup).
  const isForumSourced = sourceType === 'chief_delphi'
  const publishThreshold = isForumSourced && !candidate.matchedToolId ? 0.85 : 0.7
  const meetsBar = confidence >= publishThreshold

  // 3. Update candidate record
  const lowConfReason = !meetsBar
    ? `AI confidence too low (${Math.round(confidence * 100)}%${isForumSourced ? ', forum-sourced' : ''}) — requires manual review`
    : undefined
  await db
    .update(crawlCandidates)
    .set({
      rawMetadata: enrichedMetadata,
      classification,
      confidenceScore: confidence,
      // Suppress candidates below the (source-aware) bar rather than publishing
      status: meetsBar ? 'pending' : 'suppressed',
      rejectionReason: meetsBar ? null : (lowConfReason ?? null),
      updatedAt: new Date(),
    })
    .where(eq(crawlCandidates.id, candidateId))

  // 4. Auto-publish if confidence is sufficient
  if (meetsBar) {
    const result = await publishCandidate(candidateId, sourceType)
    console.log(
      `[enrich] candidate ${candidateId}: ${result.action}` +
        (result.reason ? ` (${result.reason})` : ` (confidence=${confidence.toFixed(2)})`),
    )
    if (submissionId) {
      if (result.action === 'created') {
        await resolveSubmission(submissionId, 'published', result.toolId)
      } else {
        // 'skipped' means confidence was below threshold inside publishCandidate
        await resolveSubmission(submissionId, 'needs_review')
      }
    }
  } else {
    console.log(`[enrich] candidate ${candidateId}: suppressed (confidence=${confidence.toFixed(2)})`)
    if (candidate.matchedToolId) await suppressMatchedTool(candidate.matchedToolId, lowConfReason ?? 'confidence too low')
    if (submissionId) await resolveSubmission(submissionId, 'needs_review', undefined, lowConfReason)
  }
}
