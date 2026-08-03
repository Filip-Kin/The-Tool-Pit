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
import type { AlbumEnrichPayload } from '@the-tool-pit/types'

interface OgMetadata {
  image?: string
  title?: string
  description?: string
  siteName?: string
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

/** Best-effort Open Graph scrape for an album cover/title. Never throws. */
async function fetchOgMetadata(url: string): Promise<OgMetadata | null> {
  try {
    const res = await politeFetch(url)
    if (!res.ok) return null
    const root = parse(await res.text())
    const meta = (prop: string) =>
      root.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') ||
      root.querySelector(`meta[name="${prop}"]`)?.getAttribute('content') ||
      undefined
    return {
      image: meta('og:image'),
      title: meta('og:title') || root.querySelector('title')?.innerText.trim(),
      description: meta('og:description'),
      siteName: meta('og:site_name'),
    }
  } catch {
    return null
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
    if (og) {
      meta.coverImageUrl = meta.coverImageUrl ?? og.image
      meta.title = meta.title ?? og.title
      meta.description = meta.description ?? og.description
      ogSiteName = og.siteName
    }
  }
  meta.photographer = meta.photographer ?? extractPhotographer(canonicalUrl, cand.provider, ogSiteName)
  meta.dateText = meta.dateText ?? extractDate(meta.title, meta.description)

  // The year identifies an event (codes/names repeat every season): use the
  // connector-supplied year, else read one from the album or thread title. Never
  // default to the current season, or historical albums mis-match.
  const matchText = meta.threadTitle || meta.title || ''
  const year = cand.targetEventYear ?? detectYear(matchText)

  // 2. Resolve the event.
  let matchedEventId: string | null = null
  let confidence = 0
  const classification: AlbumEventMatch = { eventCode: cand.targetEventCode ?? null, method: 'none' }

  if (cand.targetEventCode && year != null) {
    const [ev] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.eventCode, cand.targetEventCode), eq(events.year, year)))
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
        .where(and(eq(events.year, year), inArray(events.eventCode, tokens)))
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
        wsim: sql<number>`word_similarity(${matchText}, ${events.name})`,
      })
      .from(events)
      .where(eq(events.year, year))
      .orderBy(desc(sql`word_similarity(${matchText}, ${events.name})`))
      .limit(1)
    if (top) {
      topWsim = top.wsim
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
      .where(eq(events.year, year))
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
        .where(and(eq(events.eventCode, ai.eventCode), eq(events.year, year)))
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
