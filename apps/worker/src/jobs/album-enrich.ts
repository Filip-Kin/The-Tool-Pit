/**
 * Album enrich job.
 * For each pending album candidate: fill best-effort OG metadata, resolve the
 * target event (exact code first, then optional AI for ambiguous CD threads),
 * dedup against published albums, and write the result back. Never auto-publishes
 * - an admin promotes 'matched' candidates into albums.
 */
import { getDb } from '@the-tool-pit/db'
import { events, albums, albumCandidates, albumSubmissions } from '@the-tool-pit/db'
import type { AlbumCandidateMetadata, AlbumEventMatch } from '@the-tool-pit/db'
import { eq, and, desc, sql, inArray } from 'drizzle-orm'
import { parse } from 'node-html-parser'
import { politeFetch } from '../connectors/base.js'
import { matchEventWithAI, type EventCandidate } from '../pipeline/match-event.js'
import { classifyAlbumJunk, DEAD_LINK_REASON } from './album-junk.js'
import type { AlbumEnrichPayload } from '@the-tool-pit/types'

interface OgMetadata {
  image?: string
  title?: string
  description?: string
  siteName?: string
}

/**
 * What we store in the candidate's `classification` jsonb. It is the schema's
 * AlbumEventMatch plus a "best guess" the machine keeps even when it was not
 * confident enough to match: the admin queue shows this guess by name and score
 * so a moderator can eyeball "yes that's it" and confirm in one click instead of
 * researching a code. Extra keys live inside the existing jsonb column - no new
 * DB column - and a wider object is still assignable to AlbumEventMatch.
 */
interface AlbumClassification extends AlbumEventMatch {
  guessEventId?: string | null
  guessEventCode?: string | null
  guessEventName?: string | null
  guessConfidence?: number
}

/** The rejection reason FLL albums carry: they cannot be tied to one event. */
const FLL_NO_EVENT_REASON = 'fll_no_event_mapping'

/**
 * Retire a candidate to a distinct, filterable rejection reason and reflect it
 * on the originating submission, if any. The single exit the enrich job uses for
 * every "this is not an actionable album" verdict (FLL, dead link, junk gate) so
 * they all clear the queue the same way.
 */
async function suppressCandidate(
  db: ReturnType<typeof getDb>,
  candidateId: string,
  meta: AlbumCandidateMetadata,
  reason: string,
  submissionId: string | null,
): Promise<void> {
  await db
    .update(albumCandidates)
    .set({ status: 'suppressed', rawMetadata: meta, rejectionReason: reason, updatedAt: new Date() })
    .where(eq(albumCandidates.id, candidateId))
  if (submissionId) {
    await db
      .update(albumSubmissions)
      .set({ status: 'needs_review', updatedAt: new Date() })
      .where(eq(albumSubmissions.id, submissionId))
  }
}

/** Pull a plausible FRC season year (1992-2099) from free text, or null. */
function detectYear(text: string): number | null {
  const m = text.match(/\b(19\d{2}|20\d{2})\b/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  return y >= 1992 && y <= 2099 ? y : null
}

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec'

/** Best-effort date / date-range from an album title or description. */
function extractDate(...texts: (string | undefined)[]): string | undefined {
  for (const text of texts) {
    if (!text) continue
    // Google Photos style: "Title · Apr 15 – 18 📸"
    const dot = text.match(/·\s*([A-Za-z0-9 ,.–—-]+?)\s*(?:📸|🎬|$)/)
    if (dot && /\d/.test(dot[1])) return dot[1].trim()
    // A month-day (optionally a range / year) anywhere
    const m = text.match(
      new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+\\d{1,2}(\\s*[–-]\\s*((${MONTHS})[a-z]*\\.?\\s+)?\\d{1,2})?(,?\\s+\\d{4})?`, 'i'),
    )
    if (m) return m[0].trim()
  }
  return undefined
}

/** Photographer handle: the photo host's subdomain / user, or a real site name. */
function extractPhotographer(canonicalUrl: string, provider: string | null, ogSiteName?: string): string | undefined {
  try {
    const u = new URL(canonicalUrl)
    if (provider === 'smugmug' || provider === 'pixieset') {
      const sub = u.hostname.split('.')[0]
      if (sub && sub !== 'www') return sub
    }
    if (provider === 'flickr') {
      const seg = u.pathname.split('/').filter(Boolean)
      if (seg[0] === 'photos' && seg[1]) return seg[1]
    }
  } catch {
    // ignore
  }
  if (ogSiteName && !/^(google photos|flickr|smugmug|pixieset|google drive)$/i.test(ogSiteName.trim())) {
    return ogSiteName.trim()
  }
  return undefined
}

/**
 * Result of the one fetch enrich makes per candidate.
 * - `ok`: the page loaded, carry the Open Graph metadata.
 * - `dead`: the host said this album is gone (404/410) - a hard, non-transient
 *   signal, so the candidate can be retired as a dead link.
 * - `unknown`: any other non-200 or a network error. Deliberately NOT treated as
 *   dead: a 403/429/500 or a timeout is often a bot block or a slow host (Google
 *   Photos, Flickr), and dropping a real album on one of those would be wrong.
 */
type OgFetchResult =
  | { kind: 'ok'; meta: OgMetadata }
  | { kind: 'dead'; status: number }
  | { kind: 'unknown' }

/** HTTP statuses that mean the album is gone, not merely unreachable right now. */
const DEAD_STATUSES = new Set([404, 410])

/** Best-effort Open Graph scrape for an album cover/title. Never throws. */
async function fetchOgMetadata(url: string): Promise<OgFetchResult> {
  try {
    const res = await politeFetch(url)
    if (!res.ok) {
      return DEAD_STATUSES.has(res.status) ? { kind: 'dead', status: res.status } : { kind: 'unknown' }
    }
    const root = parse(await res.text())
    const meta = (prop: string) =>
      root.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') ||
      root.querySelector(`meta[name="${prop}"]`)?.getAttribute('content') ||
      undefined
    return {
      kind: 'ok',
      meta: {
        image: meta('og:image'),
        title: meta('og:title') || root.querySelector('title')?.innerText.trim(),
        description: meta('og:description'),
        siteName: meta('og:site_name'),
      },
    }
  } catch {
    return { kind: 'unknown' }
  }
}

export async function processAlbumEnrichJob(payload: AlbumEnrichPayload): Promise<void> {
  const db = getDb()
  const [cand] = await db.select().from(albumCandidates).where(eq(albumCandidates.id, payload.candidateId)).limit(1)
  if (!cand) {
    console.warn(`[album-enrich] candidate ${payload.candidateId} not found`)
    return
  }
  if (cand.status !== 'pending') {
    console.log(`[album-enrich] candidate ${cand.id} already ${cand.status} - skipping`)
    return
  }
  if (!cand.canonicalUrl) {
    await db
      .update(albumCandidates)
      .set({ status: 'suppressed', rejectionReason: 'missing canonical URL', updatedAt: new Date() })
      .where(eq(albumCandidates.id, cand.id))
    return
  }
  const canonicalUrl = cand.canonicalUrl

  // 1. Best-effort OG metadata for cover image / title, then derive photographer + date.
  const meta: AlbumCandidateMetadata = { ...(cand.rawMetadata ?? {}) }
  let ogSiteName: string | undefined
  if (!meta.coverImageUrl || !meta.title) {
    const og = await fetchOgMetadata(canonicalUrl)
    // A 404/410 means the album is gone: retire it to a distinct, filterable
    // reason and stop. Reuses the fetch we already make here - no extra request.
    if (og.kind === 'dead') {
      await suppressCandidate(db, cand.id, meta, DEAD_LINK_REASON, cand.submissionId)
      console.log(`[album-enrich] candidate ${cand.id} → suppressed (${DEAD_LINK_REASON}, HTTP ${og.status})`)
      return
    }
    if (og.kind === 'ok') {
      meta.coverImageUrl = meta.coverImageUrl ?? og.meta.image
      meta.title = meta.title ?? og.meta.title
      meta.description = meta.description ?? og.meta.description
      ogSiteName = og.meta.siteName
    }
  }
  meta.photographer = meta.photographer ?? extractPhotographer(canonicalUrl, cand.provider, ogSiteName)
  meta.dateText = meta.dateText ?? extractDate(meta.title, meta.description)

  // Junk gate (same rules as ingest, run again here as the net for candidates
  // that predate the gate or whose title only appeared after the OG fetch above).
  // Open Alliance threads, single videos and team general galleries are never
  // event photos: suppress to a distinct, filterable reason and stop. Conservative
  // by construction - see classifyAlbumJunk.
  const junk = classifyAlbumJunk({
    canonicalUrl,
    sourceUrl: cand.sourceUrl,
    targetEventCode: cand.targetEventCode,
    title: meta.title,
    threadTitle: meta.threadTitle,
    blurb: meta.blurb,
  })
  if (junk) {
    await suppressCandidate(db, cand.id, meta, junk.reason, cand.submissionId)
    console.log(`[album-enrich] candidate ${cand.id} → suppressed (${junk.reason})`)
    return
  }

  // FLL albums cannot be tied to a specific event (there is no per-event FLL
  // schedule to match against), so they must never sit in the actionable queue.
  // Suppress them to a distinct, filterable reason and stop - no matching work,
  // no pending row a moderator has to triage.
  if (meta.targetProgram === 'fll') {
    await suppressCandidate(db, cand.id, meta, FLL_NO_EVENT_REASON, cand.submissionId)
    console.log(`[album-enrich] candidate ${cand.id} → suppressed (${FLL_NO_EVENT_REASON})`)
    return
  }

  // The year identifies an event (codes/names repeat every season): use the
  // connector-supplied year, else read one from the album or thread title. Never
  // default to the current season, or historical albums mis-match.
  const matchText = meta.threadTitle || meta.title || ''
  const year = cand.targetEventYear ?? detectYear(matchText)

  // An album can never belong to an event that has not happened yet.
  const notFuture = sql`(${events.startDate} is null or ${events.startDate} <= now())`

  // When the source pins the FIRST program (e.g. a SmugMug FRC folder), only
  // consider events of that program, so an FRC album can't match an FTC event
  // of the same year (and vice versa).
  const programFilter = meta.targetProgram
    ? sql`${events.program} = ${meta.targetProgram}`
    : sql`true`

  // 2. Resolve the event.
  let matchedEventId: string | null = null
  let confidence = 0
  const classification: AlbumClassification = { eventCode: cand.targetEventCode ?? null, method: 'none' }

  if (cand.targetEventCode && year != null) {
    const [ev] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.eventCode, cand.targetEventCode), eq(events.year, year), notFuture, programFilter))
      .limit(1)
    if (ev) {
      matchedEventId = ev.id
      confidence = 0.9
      classification.method = 'exact_code'
    }
  }

  // 3a. Deterministic: an exact event-code token in the title (e.g. "... micmp ...").
  if (!matchedEventId && matchText && year != null) {
    const tokens = matchText
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4)
    if (tokens.length > 0) {
      const [ev] = await db
        .select({ id: events.id, eventCode: events.eventCode })
        .from(events)
        .where(and(eq(events.year, year), inArray(events.eventCode, tokens), notFuture, programFilter))
        .limit(1)
      if (ev) {
        matchedEventId = ev.id
        confidence = 0.95
        classification.eventCode = ev.eventCode
        classification.method = 'exact_code'
      }
    }
  }

  // 3b. Deterministic: word-similarity name match. word_similarity keys on the
  // distinctive part of the name (e.g. "Troy") instead of the shared
  // "FiM District Event" boilerplate, and costs no API credits.
  const NAME_MATCH_THRESHOLD = 0.6
  // Below this there is no plausible candidate, so don't spend AI on it either.
  const AI_MIN_PLAUSIBLE = 0.4
  let topWsim = 0
  if (!matchedEventId && matchText && year != null) {
    const [top] = await db
      .select({
        id: events.id,
        eventCode: events.eventCode,
        name: events.name,
        year: events.year,
        wsim: sql<number>`word_similarity(${matchText}, ${events.name})`,
      })
      .from(events)
      .where(and(eq(events.year, year), notFuture, programFilter))
      .orderBy(desc(sql`word_similarity(${matchText}, ${events.name})`))
      .limit(1)
    if (top) {
      topWsim = top.wsim
      // Keep the single best guess even when it is below the auto-match bar, so
      // the admin queue can show it by name + score for one-click confirmation.
      classification.guessEventId = top.id
      classification.guessEventCode = `${top.year}${top.eventCode}`
      classification.guessEventName = top.name
      classification.guessConfidence = top.wsim
      if (top.wsim >= NAME_MATCH_THRESHOLD) {
        matchedEventId = top.id
        confidence = top.wsim
        classification.eventCode = top.eventCode
        classification.method = 'name_match'
        classification.confidence = top.wsim
      }
    }
  }

  // 3c. AI - ONLY for the uncertain "maybe" band (a plausible but not confident
  // name match). Hopeless candidates (topWsim < 0.4) stay pending without an AI
  // call, so credits are only spent where they can actually help.
  if (!matchedEventId && matchText && year != null && topWsim >= AI_MIN_PLAUSIBLE) {
    const shortlist = (await db
      .select({
        eventCode: events.eventCode,
        name: events.name,
        startDate: events.startDate,
        week: events.week,
        stateProv: events.stateProv,
      })
      .from(events)
      .where(and(eq(events.year, year), notFuture, programFilter))
      .orderBy(desc(sql`similarity(${events.name}, ${matchText})`))
      .limit(15)) as EventCandidate[]

    const ai = await matchEventWithAI(
      { albumUrl: canonicalUrl, threadTitle: matchText, blurb: meta.blurb },
      shortlist,
    )
    if (ai.eventCode) {
      const [ev] = await db
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.eventCode, ai.eventCode), eq(events.year, year), notFuture, programFilter))
        .limit(1)
      if (ev) {
        matchedEventId = ev.id
        confidence = ai.confidence
        classification.eventCode = ai.eventCode
        classification.method = 'ai'
        classification.confidence = ai.confidence
        classification.reasoning = ai.reasoning
      }
    }
  }

  // 4. Dedup against already-published albums (canonical URL is globally unique).
  let status: string = matchedEventId ? 'matched' : 'pending'
  let matchedAlbumId: string | null = null
  const [dupAlbum] = await db
    .select({ id: albums.id })
    .from(albums)
    .where(eq(albums.canonicalUrl, canonicalUrl))
    .limit(1)
  if (dupAlbum) {
    status = 'duplicate'
    matchedAlbumId = dupAlbum.id
  }

  // 5. Write back the candidate.
  await db
    .update(albumCandidates)
    .set({
      matchedEventId,
      matchedAlbumId,
      rawMetadata: meta,
      classification,
      confidenceScore: confidence,
      status,
      updatedAt: new Date(),
    })
    .where(eq(albumCandidates.id, cand.id))

  // 6. Reflect progress on the originating submission, if any.
  if (cand.submissionId) {
    await db
      .update(albumSubmissions)
      .set({ status: status === 'duplicate' ? 'duplicate' : 'needs_review', updatedAt: new Date() })
      .where(eq(albumSubmissions.id, cand.submissionId))
  }

  console.log(`[album-enrich] candidate ${cand.id} → ${status} (method=${classification.method})`)
}
