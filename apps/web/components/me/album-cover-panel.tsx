'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The album cover, uploaded by the person who took the photographs.
 *
 * Deliberately NOT part of the autosaving edit form beside it. That form
 * commits on blur, which is right for a text box and wrong for a file: an
 * upload is a deliberate act, it can fail for reasons of its own (too big, not
 * an image), and it needs to say so. So it is its own small form with its own
 * button and its own message.
 *
 * WHY IT EXISTS. Most album hosts publish an og:image and the crawler takes the
 * cover from there. Google Drive and Dropbox folders publish nothing, and
 * Flickr blocks the cloud IP, so those albums have always sat on the event page
 * as a grey rectangle that only an admin could fix. The photographer is the one
 * person who has the picture.
 *
 * The server resizes, re-encodes and strips EXIF (lib/images/normalise.ts), so
 * nothing here has to care what came off the camera.
 */
export function AlbumCoverPanel({
  entityId,
  currentUrl,
  saveAction,
}: {
  entityId: string
  currentUrl: string | null
  saveAction: (formData: FormData) => Promise<{ error?: string; message?: string }>
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function upload(file: File) {
    setMsg(null)
    start(async () => {
      const fd = new FormData()
      fd.set('entityId', entityId)
      fd.set('cover', file)
      const res = await saveAction(fd)
      if (res.error) setMsg({ ok: false, text: res.error })
      else {
        setMsg({ ok: true, text: res.message ?? 'Cover updated.' })
        if (inputRef.current) inputRef.current.value = ''
        router.refresh()
      }
    })
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">Cover image</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        The picture on the album card. We take one from the gallery automatically where the host
        publishes one; Drive and Dropbox folders do not, so pick your own here.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {currentUrl ? (
          // A cover is an arbitrary external URL on most albums, so a plain img
          // avoids adding every album host to next/image remotePatterns.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt=""
            className="h-24 w-40 rounded-md border border-border-subtle object-cover"
          />
        ) : (
          <div className="flex h-24 w-40 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-2">
            No cover yet
          </div>
        )}

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) upload(file)
            }}
            className="text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border-subtle file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          />
          {pending && <span className="text-sm text-muted">Uploading…</span>}
          {msg && (
            <span className={msg.ok ? 'text-sm text-rookie' : 'text-sm text-frc'}>{msg.text}</span>
          )}
        </div>
      </div>
    </section>
  )
}
