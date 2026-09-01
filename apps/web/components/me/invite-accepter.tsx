'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Accept an invite link. A deliberate button rather than an automatic accept on
 * page load, so the token is spent by an intentional click and not by a link
 * preview or a prefetch.
 */
export function InviteAccepter({
  token,
  acceptAction,
}: {
  token: string
  acceptAction: (token: string) => Promise<{ error?: string; message?: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function onAccept() {
    setErr(null)
    setMsg(null)
    start(async () => {
      const res = await acceptAction(token)
      if (res.error) setErr(res.error)
      else {
        setMsg(res.message ?? 'Done.')
        setDone(true)
        router.refresh()
      }
    })
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-5">
      {!done ? (
        <>
          <p className="text-sm text-muted">
            Accepting this invite adds the listing to the ones you manage.
          </p>
          <button
            type="button"
            onClick={onAccept}
            disabled={pending}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            {pending ? 'Accepting…' : 'Accept invite'}
          </button>
        </>
      ) : (
        <p className="text-sm text-foreground">{msg}</p>
      )}

      {err && (
        <p role="alert" className="mt-3 text-sm text-frc">
          {err}
        </p>
      )}

      <p className="mt-5 text-sm">
        <a href="/me/listings" className="text-primary hover:underline">
          Go to your listings
        </a>
      </p>
    </div>
  )
}
