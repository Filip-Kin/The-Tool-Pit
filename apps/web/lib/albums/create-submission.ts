import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { albums, albumSubmissions, albumCandidates, events, canonicalizeAlbumUrl, resolveShareUrl } from '@the-tool-pit/db'
import { getAlbumEnrichQueue } from './queue'
import { sendApprovalNotice, reviewAlbumUrl } from '@the-tool-pit/types'
import { fetchOgImage } from './og'

interface CreateAlbumSubmissionInput {
  url: string
  eventHint?: string
  /** Event code typed or auto-filled from a picked event. */
  code?: string
  /** Season year the submitter says the album is from. */
  year?: number
  /** FIRST program (frc/ftc) from the toggle. */
  program?: 'frc' | 'ftc'
  /** Full TBA key when the submitter picked a real event - the strongest signal. */
  tbaKey?: string
  photographerHint?: string
  note?: string
  submitterIpHash: string
  /**
   * The signed-in user, when there was one. Optional on purpose: sign-in is
   * never a wall in front of a submission. It only buys attribution and an
   * email when a moderator gets to it.
   */
  submittedByUserId?: string
  /**
   * What the "just passing it along" box said, resolved by the route with
   * lib/listings/passing-along.ts. NULL for a signed-out submitter, TRUE means
   * the listing is theirs when a moderator approves it.
   */
  submitterOwns?: boolean | null
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

  // Resolve short share links (photos.app.goo.gl) so a submission of either the short or the
  // expanded Google Photos URL dedupes against the same canonical album.
  const resolvedUrl = await resolveShareUrl(input.url)
  const canon = canonicalizeAlbumUrl(resolvedUrl, { allowUnknown: true })
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
    return { status: 'duplicate', message: 'This album was already submitted and is waiting for review.' }
  }

  const hint = input.eventHint?.trim()
  const typedCode = input.code?.trim().toLowerCase()
  const validYear = input.year && input.year >= 1992 && input.year <= new Date().getFullYear() + 1 ? input.year : undefined

  // Strongest signal: the submitter picked a real event (full TBA key). Resolve
  // it to the exact code/year/program so enrich matches by exact code.
  let targetEventCode: string | undefined
  let targetEventYear: number | undefined
  let targetProgram: 'frc' | 'ftc' | undefined = input.program
  let resolvedName: string | undefined

  const key = input.tbaKey?.trim().toLowerCase()
  if (key && /^(19|20)\d{2}[a-z0-9]+$/.test(key)) {
    const [ev] = await db
      .select({ eventCode: events.eventCode, year: events.year, program: events.program, name: events.name })
      .from(events)
      .where(eq(events.tbaKey, key))
      .limit(1)
    if (ev) {
      targetEventCode = ev.eventCode
      targetEventYear = ev.year
      targetProgram = ev.program === 'ftc' ? 'ftc' : 'frc'
      resolvedName = ev.name
    }
  }

  // Otherwise fall back to a typed code (or a code-shaped hint) + year.
  if (!targetEventCode) {
    const codeCandidate = typedCode || (hint && CODE_HINT_RE.test(hint) ? hint.toLowerCase() : undefined)
    targetEventCode = codeCandidate
    targetEventYear = validYear ?? (codeCandidate ? new Date().getFullYear() : undefined)
  }

  const [submission] = await db
    .insert(albumSubmissions)
    .values({
      url: input.url,
      eventHint: input.eventHint,
      photographerHint: input.photographerHint,
      submitterNote: input.note,
      submitterIpHash: input.submitterIpHash,
      submittedByUserId: input.submittedByUserId ?? null,
      submitterOwns: input.submitterOwns ?? null,
      status: 'pending',
      pipelineLog: [
        { stage: 'received', status: 'ok', message: 'Submission queued for review', timestamp: new Date().toISOString() },
      ],
    })
    .returning({ id: albumSubmissions.id })

  // Title seeds the matcher (and admin display): the resolved event name if we
  // have one, else the free-text hint (when it's a name, not a bare code).
  const nameHint = hint && !CODE_HINT_RE.test(hint) ? hint : undefined
  const title = resolvedName ?? (nameHint ? (targetEventYear ? `${nameHint} ${targetEventYear}` : nameHint) : undefined)
  const [candidate] = await db
    .insert(albumCandidates)
    .values({
      sourceUrl: input.url,
      canonicalUrl: canon.canonicalUrl,
      provider: canon.provider,
      targetEventCode,
      targetEventYear,
      submissionId: submission.id,
      rawMetadata: {
        photographer: input.photographerHint,
        ...(targetProgram ? { targetProgram } : {}),
        ...(title ? { title } : {}),
        ...(input.note ? { blurb: input.note } : {}),
      },
      status: 'pending',
    })
    .returning({ id: albumCandidates.id })

  await getAlbumEnrichQueue().add('album-enrich', { candidateId: candidate.id, submissionId: submission.id })

  // Discord ping so a moderator sees new submissions promptly. The cover is
  // scraped first and awaited INSIDE this detached call, never before the
  // return: an album host that takes ten seconds to answer must not make the
  // submitter wait ten seconds for "thanks". og.ts swallows its own errors and
  // hands back null, and not every host exposes an og:image (Drive and Dropbox
  // folders, Flickr from the cloud IP), so those simply arrive without a
  // picture.
  const eventLabel =
    resolvedName || input.eventHint
      ? [resolvedName ?? input.eventHint, targetEventYear].filter(Boolean).join(' · ')
      : null

  void (async () => {
    const cover = await fetchOgImage(canon.canonicalUrl || input.url).catch(() => null)
    sendApprovalNotice({
      vertical: 'album',
      title: eventLabel ?? input.url,
      reviewUrl: reviewAlbumUrl(candidate.id),
      sourceUrl: input.url,
      imageUrl: cover,
      facts: [
        { label: 'Event', value: eventLabel },
        { label: 'Event code', value: targetEventCode, inline: true },
        { label: 'Year', value: targetEventYear, inline: true },
        { label: 'Program', value: targetProgram?.toUpperCase(), inline: true },
        { label: 'Provider', value: canon.provider, inline: true },
        { label: 'Photographer', value: input.photographerHint, inline: true },
        { label: 'Note', value: input.note },
      ],
    })
  })().catch((err: unknown) => {
    console.error(`[albums/submit] notice failed: ${(err as Error).message}`)
  })

  return {
    submissionId: submission.id,
    status: 'pending',
    message: "Thanks! We'll review this album and add it to the event.",
  }
}
