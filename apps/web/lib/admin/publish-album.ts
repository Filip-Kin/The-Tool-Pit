/**
 * Admin-initiated publish: promotes a matched album candidate into a published
 * album record + source evidence. The candidate must already have a resolved
 * event (matchedEventId) - set by enrich or by the admin via setAlbumEventMatch.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albums, albumSources, albumCandidates, albumCrawlJobs, albumSubmissions } from '@the-tool-pit/db'
import type { NewAlbum, AlbumCandidateMetadata } from '@the-tool-pit/db'

const CONNECTOR_SOURCE_TYPE: Record<string, string> = {
  fim_albums: 'firstinmichigan',
  chief_delphi_albums: 'chief_delphi',
  tba_events: 'tba',
}

export async function adminPublishAlbum(candidateId: string): Promise<{ albumId: string } | { error: string }> {
  const db = getDb()

  const [candidate] = await db
    .select()
    .from(albumCandidates)
    .where(eq(albumCandidates.id, candidateId))
    .limit(1)

  if (!candidate) return { error: `Candidate ${candidateId} not found` }
  if (!candidate.matchedEventId) return { error: 'No event matched yet. Set the event first.' }
  if (!candidate.canonicalUrl) return { error: 'Candidate has no album URL.' }

  // Determine discovery source type.
  let sourceType = 'manual'
  if (candidate.submissionId) {
    sourceType = 'manual'
  } else if (candidate.jobId) {
    const [job] = await db
      .select({ connector: albumCrawlJobs.connector })
      .from(albumCrawlJobs)
      .where(eq(albumCrawlJobs.id, candidate.jobId))
      .limit(1)
    sourceType = (job && CONNECTOR_SOURCE_TYPE[job.connector]) || candidate.provider || 'manual'
  } else {
    sourceType = candidate.provider || 'manual'
  }

  const meta = (candidate.rawMetadata ?? {}) as AlbumCandidateMetadata

  const albumData: NewAlbum = {
    eventId: candidate.matchedEventId,
    url: candidate.canonicalUrl,
    canonicalUrl: candidate.canonicalUrl,
    provider: candidate.provider ?? 'other',
    sourceType,
    title: meta.title ?? null,
    photographer: meta.photographer ?? null,
    description: meta.description ?? null,
    coverImageUrl: meta.coverImageUrl ?? null,
    status: 'published',
    publishedAt: new Date(),
  }

  const [album] = await db.insert(albums).values(albumData).returning({ id: albums.id })
  const albumId = album.id

  await db.insert(albumSources).values({
    albumId,
    sourceType,
    sourceUrl: candidate.sourceUrl,
    rawMetadata: candidate.rawMetadata,
    notes: 'Admin-approved from album candidate review',
  })

  await db
    .update(albumCandidates)
    .set({ status: 'published', matchedAlbumId: albumId, updatedAt: new Date() })
    .where(eq(albumCandidates.id, candidateId))

  if (candidate.submissionId) {
    await db
      .update(albumSubmissions)
      .set({ status: 'published', resolvedAlbumId: albumId, updatedAt: new Date() })
      .where(eq(albumSubmissions.id, candidate.submissionId))
  }

  return { albumId }
}
