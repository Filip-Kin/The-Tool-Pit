import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@the-tool-pit/db'
import { crawlCandidates, submissions, toolLinks, tools } from '@the-tool-pit/db'
import type { PipelineLogEntry, CandidateClassification } from '@the-tool-pit/db'
import { classifyCandidate } from '../pipeline/classify.js'
import { fetchGitHubRepo, parseGitHubUrl } from '../connectors/github.js'
import { publishCandidate } from '../pipeline/publish.js'
import { extractMetadata } from '../pipeline/extract.js'
import { notifySubmissionAutoPublished } from '../notifications/submissions.js'
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

// #region documentation-subpage gate
// A docs site puts a "GitHub" link in its navbar, so extract.ts hands EVERY page of that
// site the same repo URL. This job then fetches the repo, backfills its description and
// topics onto the page, and publish.ts writes the repo's star count as the page's
// popularity. That is how one docs site became sixteen AdvantageKit listings, each
// carrying the repo's 246 stars, and how a VScouter page inherited 5075 stars from
// readthedocs/sphinx_rtd_theme, the docs THEME, and led the home page.
//
// The classifier prompt already says an individual doc page is not a tool, and it is not
// enough: the classifier sees one page in isolation, and by the time it sees it the page
// has been dressed in the real project's repo, description and topics. Neither does dedup
// stop it, because checkDuplicateByUrl deliberately does not treat a same-host match as a
// duplicate and pg_trgm finds no similarity between "AdvantageKit" and "Installation".
// These two checks are deterministic, run before we spend API credits, and use the one
// thing the classifier cannot see: what is already published.

/** A docs sidebar label rendered as the page title, e.g. "📦 Installation". */
const EMOJI_TITLE_RE = /^\p{Extended_Pictographic}/u

/** The whole title is a docs heading. Tested after any leading emoji is stripped. */
const BARE_HEADING_RE = /^(?:installation|installing|getting started|get started|quick ?start|setup|set up|usage|configuration|configuring|introduction|overview|welcome|home|index|downloads?|contributing|changelog|release notes|faq|frequently asked questions|glossary|troubleshooting|prerequisites|tutorials?|examples?|api reference|reference|documentation|docs)$/i

/** Site chrome of the form "Home | Product" or "Welcome - Product Documentation". */
const DOC_CHROME_RE = /^(?:home|welcome|introduction|overview|getting started|installation|docs|documentation)\s*[|\u2013\u2014-]\s*\S/i

/** Site chrome of the form "Auto Factory - Choreo Documentation". */
const TRAILING_DOCS_RE = /\s[|\u2013\u2014-]\s[^|]*\b(?:documentation|docs)\s*$/i

/** True when the URL points at something below the site root, e.g. "/getting-started". */
function hasSubPath(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').length > 0
  } catch {
    return false
  }
}

/**
 * Deterministic detector for a page title that is a documentation heading rather than a
 * product name. Returns a suppression reason, or null if the title looks like a real name.
 *
 * Everything except the emoji rule also requires the URL to be below the site root, so a
 * product whose own home page is titled "Home | 118 Everybot" is left alone.
 */
export function detectDocPageTitle(title: string, url: string): string | null {
  const t = title.trim()
  if (!t) return null

  if (EMOJI_TITLE_RE.test(t)) {
    return `Documentation page title (starts with an emoji: "${t.slice(0, 60)}")`
  }

  if (!hasSubPath(url)) return null

  const withoutEmoji = t.replace(/^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+/u, '')
  if (BARE_HEADING_RE.test(withoutEmoji)) {
    return `Documentation page title (bare heading: "${t.slice(0, 60)}")`
  }
  if (DOC_CHROME_RE.test(t) || TRAILING_DOCS_RE.test(t)) {
    return `Documentation page title (site chrome: "${t.slice(0, 60)}")`
  }

  return null
}

/**
 * If the GitHub repo scraped off this page already belongs to a published tool, the page
 * is a page OF that tool, not a new one. Returns the owning tool, or null.
 *
 * A candidate that IS the repo is exempt: that is the project itself arriving, possibly
 * after one of its own doc pages, and it must not be suppressed in favour of the page.
 */
async function findPublishedToolForRepo(
  githubUrl: string,
  candidateUrl: string,
  excludeToolId: string | null,
): Promise<{ name: string; slug: string } | null> {
  const parsed = parseGitHubUrl(githubUrl)
  if (!parsed) return null
  const key = `${parsed.owner}/${parsed.repo}`.toLowerCase()

  const self = parseGitHubUrl(candidateUrl)
  if (self && `${self.owner}/${self.repo}`.toLowerCase() === key) return null

  const db = getDb()
  const rows = await db
    .select({ id: tools.id, name: tools.name, slug: tools.slug, url: toolLinks.url })
    .from(toolLinks)
    .innerJoin(tools, eq(tools.id, toolLinks.toolId))
    .where(
      and(
        eq(tools.status, 'published'),
        eq(toolLinks.linkType, 'github'),
        sql`lower(${toolLinks.url}) like ${`%github.com/${key}%`}`,
      ),
    )
    .limit(20)

  for (const row of rows) {
    if (row.id === excludeToolId) continue
    const p = parseGitHubUrl(row.url)
    if (p && `${p.owner}/${p.repo}`.toLowerCase() === key) {
      return { name: row.name, slug: row.slug }
    }
  }
  return null
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

  // 2b-ii. Documentation-subpage gate. Skipped for the two trusted connectors below, which
  //        emit GitHub repos directly and are classified without a model at all.
  if (sourceType !== 'spectrum_cad' && sourceType !== 'github_team_code') {
    // The chrome link counts here and nowhere else. extract.ts refuses to treat a
    // navbar or footer repo as the page's own, which is right, and that same link
    // is still the clearest evidence that this page belongs to a listed tool.
    const repoHint = githubUrl ?? (enrichedMetadata.referencedGitHubUrl as string | undefined)
    const owner = repoHint
      ? await findPublishedToolForRepo(repoHint, url, candidate.matchedToolId)
      : null
    const docReason = owner
      ? `Page of an already-listed tool: its GitHub link is ${repoHint}, already published as "${owner.name}" (${owner.slug})`
      : detectDocPageTitle(qualityTitle, url)

    if (docReason) {
      await db
        .update(crawlCandidates)
        .set({ status: 'suppressed', confidenceScore: 0, rejectionReason: docReason, updatedAt: new Date() })
        .where(eq(crawlCandidates.id, candidateId))
      console.log(`[enrich] candidate ${candidateId}: suppressed (${docReason})`)
      if (candidate.matchedToolId) await suppressMatchedTool(candidate.matchedToolId, docReason)
      if (submissionId) await resolveSubmission(submissionId, 'needs_review', undefined, docReason)
      return
    }
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

  // 2d. GitHub team code / CAD: the connector only emits repos whose team
  //     number is written into the org, repo name or topics, and the season
  //     comes from the repo name or its last push. A model has nothing to add
  //     to that, and a sweep can return thousands of repos, so this is
  //     classified deterministically for the same reason spectrum_cad is.
  if (sourceType === 'github_team_code') {
    const kws = (enrichedMetadata.keywords as string[] | undefined) ?? []
    const isCad = kws.includes('team_cad')
    const teamNumber = parseKeywordInt(kws, 'team:')
    const program = kws.includes('ftc') ? 'ftc' : 'frc'
    const teamClassification: CandidateClassification = {
      toolType: 'github_project',
      programs: [program],
      isTeamCode: !isCad,
      isTeamCad: isCad,
      teamNumber,
      seasonYear: parseKeywordInt(kws, 'year:'),
      summary: ((enrichedMetadata.description as string | undefined) || (enrichedMetadata.title as string | undefined) || '').slice(0, 300),
      confidence: 0.9,
      reasoning: `Team ${teamNumber ?? '?'} ${isCad ? 'CAD' : 'robot code'} repository (team number read from the repo itself)`,
    }
    await db
      .update(crawlCandidates)
      .set({ rawMetadata: enrichedMetadata, classification: teamClassification, confidenceScore: 0.9, status: 'pending', rejectionReason: null, updatedAt: new Date() })
      .where(eq(crawlCandidates.id, candidateId))
    const result = await publishCandidate(candidateId, sourceType)
    console.log(`[enrich] candidate ${candidateId} (github_team_code): ${result.action}`)
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
        // The one publish that no admin ever saw. The submitter gets the same
        // email either way, or the only people who hear back are the ones whose
        // submission happened to score badly enough to need a human.
        await notifySubmissionAutoPublished(submissionId, result.toolId)
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
