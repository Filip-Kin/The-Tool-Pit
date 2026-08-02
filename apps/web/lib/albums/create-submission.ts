import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albums, albumSubmissions, albumCandidates, canonicalizeAlbumUrl } from '@the-tool-pit/db'
import { getAlbumEnrichQueue } from './queue'

interface CreateAlbumSubmissionInput {
  url: string
  eventHint?: string
  photographerHint?: string
  note?: string
  submitterIpHash: string
}

export interface CreateAlbumSubmissionResult {
  submissionId?: string
  status: 'pending' | 'duplicate'
  message: string
}

/** A bare event code like "mimid" (not a name, not a pure number). */
const CODE_HINT_RE = /^[a-z][a-z0-9]{2,11}$/i

export async function createAlbumSubmission(
  input: CreateAlbumSubmissionInput,
): Promise<CreateAlbumSubmissionResult> {
  const db = getDb()

  const canon = canonicalizeAlbumUrl(input.url, { allowUnknown: true })
  if (!canon) return { status: 'duplicate', message: 'That does not look like a valid album URL.' }

  // Already published?
  const [existingAlbum] = await db
    .select({ id: albums.id })
    .from(albums)
    .where(eq(albums.canonicalUrl, canon.canonicalUrl))
    .limit(1)
  if (existingAlbum) {
    return { status: 'duplicate', message: 'This album is already listed.' }
  }

  // Already submitted / in the queue?
  const [existingCand] = await db
    .select({ id: albumCandidates.id })
    .from(albumCandidates)
    .where(eq(albumCandidates.canonicalUrl, canon.canonicalUrl))
    .limit(1)
  if (existingCand) {
    return { status: 'duplicate', message: 'Thanks — this album has already been submitted and is awaiting review.' }
  }

  const hint = input.eventHint?.trim()
  const targetEventCode = hint && CODE_HINT_RE.test(hint) ? hint.toLowerCase() : undefined
  const targetEventYear = targetEventCode ? new Date().getFullYear() : undefined

  const [submission] = await db
    .insert(albumSubmissions)
    .values({
      url: input.url,
      eventHint: input.eventHint,
      photographerHint: input.photographerHint,
      submitterNote: input.note,
      submitterIpHash: input.submitterIpHash,
      status: 'pending',
      pipelineLog: [
        { stage: 'received', status: 'ok', message: 'Submission queued for review', timestamp: new Date().toISOString() },
      ],
    })
    .returning({ id: albumSubmissions.id })

  const [candidate] = await db
    .insert(albumCandidates)
    .values({
      sourceUrl: input.url,
      canonicalUrl: canon.canonicalUrl,
      provider: canon.provider,
      targetEventCode,
      targetEventYear,
      submissionId: submission.id,
      rawMetadata: { photographer: input.photographerHint },
      status: 'pending',
    })
    .returning({ id: albumCandidates.id })

  await getAlbumEnrichQueue().add('album-enrich', { candidateId: candidate.id, submissionId: submission.id })

  return {
    submissionId: submission.id,
    status: 'pending',
    message: "Thanks! We'll review this album and add it to the event.",
  }
}
