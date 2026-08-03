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
import { eq, and, desc, sql } from 'drizzle-orm'
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

  const year = cand.targetEventYear ?? new Date().getFullYear()

  // 1. Best-effort OG metadata for cover image / title.
  const meta: AlbumCandidateMetadata = { ...(cand.rawMetadata ?? {}) }
  if (!meta.coverImageUrl || !meta.title) {
    const og = await fetchOgMetadata(canonicalUrl)
    if (og) {
      meta.coverImageUrl = meta.coverImageUrl ?? og.image
      meta.title = meta.title ?? og.title
      meta.description = meta.description ?? og.description
      meta.photographer = meta.photographer ?? og.siteName
    }
  }

  // 2. Resolve the event.
  let matchedEventId: string | null = null
  let confidence = 0
  const classification: AlbumEventMatch = { eventCode: cand.targetEventCode ?? null, method: 'none' }

  if (cand.targetEventCode) {
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

  // 3. AI fallback for ambiguous CD threads.
  if (!matchedEventId && meta.threadTitle) {
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
      .orderBy(desc(sql`similarity(${events.name}, ${meta.threadTitle})`))
      .limit(15)) as EventCandidate[]

    const ai = await matchEventWithAI(
      { albumUrl: canonicalUrl, threadTitle: meta.threadTitle, blurb: meta.blurb },
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
