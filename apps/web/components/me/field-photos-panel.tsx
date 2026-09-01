'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'

/**
 * The photographs on a practice field's own page, managed by the team that runs
 * it.
 *
 * WHY IT EXISTS. Every published field carries a gallery and only an admin
 * could ever put anything in it. So an owner could correct the ceiling height
 * and the access hours and still not show a visiting team what the space
 * actually looks like, which is the first thing anyone scrolls for. A field
 * with no photographs reads as a field nobody has been to.
 *
 * Deliberately NOT part of the autosaving form above it, for the reason the
 * album cover panel gives: a file upload is a deliberate act, it fails for
 * reasons of its own (too big, not an image, too many), and it has to say so.
 *
 * Removing asks first, in the same shape the leave panel uses: the bin turns
 * into a plain "Remove?" with two answers, and nothing is sent until the second
 * press. A gallery is a place where a mis-tapped icon costs somebody a photo
 * they no longer have.
 */
export function FieldPhotosPanel({
  entityId,
  photos,
  maxPhotos,
  addAction,
  removeAction,
}: {
  entityId: string
  /** Ids in gallery order. The bytes are served by /api/fields/photo/[id]. */
  photos: readonly string[]
  maxPhotos: number
  addAction: (formData: FormData) => Promise<{ error?: string; message?: string }>
  removeAction: (entityId: string, photoId: string) => Promise<{ error?: string; message?: string }>
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [asking, setAsking] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const full = photos.length >= maxPhotos

  function add(files: FileList) {
    setMsg(null)
    start(async () => {
      const fd = new FormData()
      fd.set('entityId', entityId)
      for (const file of Array.from(files)) fd.append('photos', file)
      const res = await addAction(fd)
      if (res.error) setMsg({ ok: false, text: res.error })
      else {
        setMsg({ ok: true, text: res.message ?? 'Photos added.' })
        router.refresh()
      }
      // Cleared either way, so picking the same file again still fires change.
      if (inputRef.current) inputRef.current.value = ''
    })
  }

  function remove(photoId: string) {
    setMsg(null)
    setAsking(null)
    start(async () => {
      const res = await removeAction(entityId, photoId)
      if (res.error) setMsg({ ok: false, text: res.error })
      else router.refresh()
    })
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">Photos</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        What the space looks like. The first one is the picture on your field&rsquo;s card. Up to{' '}
        {maxPhotos}, and we resize them and strip the location tags off before they go up.
      </p>

      {photos.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-3">
          {photos.map((id, i) => (
            <li key={id} className="relative">
              {/* Served from a bytea column through an API route, so next/image
                  would only add a second hop and a cache we do not need. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/fields/photo/${id}`}
                alt={i === 0 ? 'The picture on your field card' : `Photo ${i + 1}`}
                className="h-28 w-40 rounded-md border border-border-subtle object-cover"
              />
              {asking === id ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-md bg-background/90 p-2">
                  <span className="text-xs font-medium text-foreground">Remove this photo?</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => remove(id)}
                      disabled={pending}
                      className="rounded bg-frc px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-frc/90 disabled:opacity-40"
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setAsking(null)}
                      className="rounded px-2 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
                    >
                      Keep
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAsking(id)}
                  disabled={pending}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute right-1.5 top-1.5 rounded-md bg-background/80 p-1.5 text-muted transition-colors hover:bg-background hover:text-frc disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={pending || full}
          onChange={(e) => {
            const files = e.target.files
            if (files && files.length > 0) add(files)
          }}
          className="text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border-subtle file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground disabled:opacity-40"
        />
        {full && (
          <span className="text-sm text-muted-2">
            That is {maxPhotos}. Remove one to add another.
          </span>
        )}
        {pending && <span className="text-sm text-muted">Working…</span>}
        {msg && <span className={msg.ok ? 'text-sm text-rookie' : 'text-sm text-frc'}>{msg.text}</span>}
      </div>
    </section>
  )
}
