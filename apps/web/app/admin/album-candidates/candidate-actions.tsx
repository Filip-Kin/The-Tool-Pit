'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  approveAlbumCandidate,
  suppressAlbumCandidate,
  setAlbumEventMatch,
  renameAlbumTitle,
  refetchAlbumCover,
  uploadAlbumCover,
  deletePublishedAlbum,
} from './actions'
import { ReasonButton } from '@/components/admin/reason-button'

export function AlbumCandidateActions({
  candidateId,
  status,
  hasEvent,
  targetEventCode,
  targetEventYear,
  matchedEventKey,
  albumTitle,
}: {
  candidateId: string
  status: string
  hasEvent: boolean
  targetEventCode: string | null
  targetEventYear: number | null
  matchedEventKey: string | null
  albumTitle: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Pre-fill the full TBA key (year + code) - matched/published show the current
  // event so it can be corrected; unmatched show the connector's best guess.
  const [code, setCode] = useState(
    matchedEventKey ?? (targetEventCode ? `${targetEventYear ?? ''}${targetEventCode}` : ''),
  )
  const [title, setTitle] = useState(albumTitle)
  const fileRef = useRef<HTMLInputElement>(null)

  if (status === 'duplicate') {
    return <span className="text-xs text-muted-2">duplicate</span>
  }

  function run(fn: () => Promise<{ error?: string } | void>) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (res && 'error' in res && res.error) setError(res.error)
      router.refresh()
    })
  }

/**
 * Longest edge we keep for a cover. An album cover is rendered at a few hundred
 * pixels; anything past this is bytes nobody sees.
 */
const COVER_MAX_EDGE = 1600
const COVER_QUALITY = 0.85

/**
 * Shrink an image in the browser before it is uploaded.
 *
 * Covers were failing with "An unexpected response was received from the
 * server", which is what a server action shows when the response is not a valid
 * action response at all. The cause is size: a phone photo is routinely 8 to 12
 * MB and the whole action payload has to fit under next.config's 12mb
 * serverActions limit, so files near it are rejected BEFORE the action runs and
 * there is no clean error to report.
 *
 * Downscaling here means the request is a few hundred KB rather than megabytes,
 * which also matters because these are stored as bytea in Postgres and served
 * back through an API route.
 *
 * Returns the original file untouched if anything goes wrong, so a browser
 * without canvas support degrades to the old behaviour rather than blocking the
 * upload.
 */
async function shrinkImage(file: File): Promise<File> {
  try {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, COVER_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 2 * 1024 * 1024) return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', COVER_QUALITY),
    )
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

  function onCoverChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    run(async () => {
      const shrunk = await shrinkImage(file)
      const fd = new FormData()
      fd.set('cover', shrunk)
      return uploadAlbumCover(candidateId, fd)
    })
  }

  const canModerate = status === 'pending' || status === 'matched' || status === 'suppressed'

  return (
    <div className="flex flex-col items-end gap-1.5">
      {canModerate && (
        <div className="flex gap-2">
          {/* Approve only shows once an event is set - without one there's
              nothing to approve (setting the event below auto-publishes). */}
          {hasEvent && (
            <button
              disabled={pending}
              title="Publish this album"
              onClick={() => run(() => approveAlbumCandidate(candidateId))}
              className="rounded bg-green-700/20 px-2.5 py-1 text-xs font-medium text-green-400 hover:bg-green-700/40 transition-colors disabled:opacity-40"
            >
              {pending ? '…' : 'Approve'}
            </button>
          )}
          {status !== 'suppressed' && (
            <ReasonButton
              label="Suppress"
              confirmLabel="Reject"
              disabled={pending}
              className="rounded bg-surface-3 px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground transition-colors disabled:opacity-40"
              onConfirm={(reason) => suppressAlbumCandidate(candidateId, reason)}
            />
          )}
        </div>
      )}
      {status === 'published' && <span className="text-xs text-official">published</span>}

      <div className="flex gap-1">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder=""
          className="w-28 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        />
        <button
          disabled={pending || !code.trim()}
          title={hasEvent ? 'Change the matched event' : 'Set the event and publish this album'}
          onClick={() => run(() => setAlbumEventMatch(candidateId, code))}
          className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
        >
          {hasEvent ? 'Change event' : 'Set & publish'}
        </button>
      </div>

      {status === 'published' && (
        <div className="mt-1 flex w-full flex-col items-end gap-1.5 border-t border-border-subtle pt-2">
          <div className="flex gap-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Album title"
              className="w-40 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
            />
            <button
              disabled={pending || !title.trim() || title.trim() === albumTitle}
              onClick={() => run(() => renameAlbumTitle(candidateId, title))}
              className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
            >
              Rename
            </button>
          </div>
          <div className="flex gap-2">
            <button
              disabled={pending}
              onClick={() => run(() => refetchAlbumCover(candidateId))}
              className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
            >
              {pending ? '…' : 'Refetch cover'}
            </button>
            <button
              disabled={pending}
              onClick={() => fileRef.current?.click()}
              className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-40"
            >
              Upload cover
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onCoverChosen} />
            {/* The only route a LIVE album comes down, which is why the
                takedown email is wired here and not on Suppress: Suppress is
                only ever offered on a candidate that was never published. */}
            <ReasonButton
              label="Remove"
              confirmLabel="Remove"
              placeholder="Why it is coming down. The submitter is sent this."
              disabled={pending}
              className="rounded bg-frc/15 px-2 py-1 text-xs font-medium text-frc hover:bg-frc/25 transition-colors disabled:opacity-40"
              onConfirm={(reason) => deletePublishedAlbum(candidateId, reason)}
            />
          </div>
        </div>
      )}
      {error && <p className="max-w-[12rem] text-right text-[10px] text-frc">{error}</p>}
    </div>
  )
}
