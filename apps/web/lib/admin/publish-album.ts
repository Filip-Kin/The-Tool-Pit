/**
 * Admin-initiated publish: promotes a matched album candidate into a published
 * album record + source evidence. The candidate must already have a resolved
 * event (matchedEventId) - set by enrich or by the admin via setAlbumEventMatch.
 */
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albums, albumSources, albumCandidates, albumCrawlJobs, albumSubmissions, events } from '@the-tool-pit/db'
import type { NewAlbum, AlbumCandidateMetadata, AlbumSourceType } from '@the-tool-pit/db'
import { ALBUM_SOURCE_TYPES } from '@the-tool-pit/db'

/**
 * Every album connector, and the source type it means.
 *
 * It covered three of the seven. flickr_albums, smugmug_albums, toa_events and
 * reanalyze_candidates all fell through to the candidate's PROVIDER, which
 * answers a different question: provider is who hosts the photos, source type
 * is how we found them. The two tuples share six values, so the mistake mostly
 * produced a right-looking answer and occasionally wrote a value that is not a
 * source type at all.
 */
const CONNECTOR_SOURCE_TYPE: Record<string, AlbumSourceType> = {
  fim_albums: 'firstinmichigan',
  chief_delphi_albums: 'chief_delphi',
  flickr_albums: 'flickr',
  smugmug_albums: 'smugmug',
  tba_events: 'tba',
  toa_events: 'toa',
  // Not a discovery source. It re-reads candidates we already hold, so the
  // provider fallback below is the right answer for one of these.
}

/**
 * The provider, but only when it is also a source type.
 *
 * The fallback used to be `candidate.provider || 'manual'` with no check, so a
 * Google Drive album was published with source_type 'google_drive', a value no
 * screen filters on and no tuple contains.
 */
function sourceTypeFromProvider(provider: string | null): AlbumSourceType {
  const valid = ALBUM_SOURCE_TYPES as readonly string[]
  return provider && valid.includes(provider) ? (provider as AlbumSourceType) : 'manual'
}

export async function adminPublishAlbum(
  candidateId: string,
): Promise<{ albumId: string; eventId: string; eventCode?: string; tbaKey?: string } | { error: string }> {
  const db = getDb()

  const [candidate] = await db
    .select()
    .from(albumCandidates)
    .where(eq(albumCandidates.id, candidateId))
    .limit(1)

  if (!candidate) return { error: `Candidate ${candidateId} not found` }
  if (!candidate.matchedEventId) return { error: 'No event matched yet. Set the event first.' }
  if (!candidate.canonicalUrl) return { error: 'Candidate has no album URL.' }

  const [event] = await db
    .select({ eventCode: events.eventCode, tbaKey: events.tbaKey })
    .from(events)
    .where(eq(events.id, candidate.matchedEventId))
    .limit(1)

  // Determine discovery source type.
  let sourceType: AlbumSourceType = 'manual'
  if (candidate.submissionId) {
    sourceType = 'manual'
  } else if (candidate.jobId) {
    const [job] = await db
      .select({ connector: albumCrawlJobs.connector })
      .from(albumCrawlJobs)
      .where(eq(albumCrawlJobs.id, candidate.jobId))
      .limit(1)
    sourceType = (job && CONNECTOR_SOURCE_TYPE[job.connector]) || sourceTypeFromProvider(candidate.provider)
  } else {
    sourceType = sourceTypeFromProvider(candidate.provider)
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
    dateText: meta.dateText ?? null,
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

  return { albumId, eventId: candidate.matchedEventId, eventCode: event?.eventCode, tbaKey: event?.tbaKey }
}
