'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { entityNoun } from './listing-labels'
import type { ClaimableListing } from '@/lib/queries/listing-ownership'

/**
 * Start a claim on a specific listing the user reached from its public page.
 *
 * The button explains what will happen before it happens: instant for a field
 * you submitted, a repo token for a tool with a GitHub repo, a wait for a human
 * otherwise. Honesty here is the point, because a claim that quietly does
 * nothing is how people conclude the feature is broken.
 */
export function ClaimStarter({
  target,
  verifyFilename,
  startAction,
}: {
  target: ClaimableListing
  verifyFilename: string
  startAction: (
    entityType: string,
    entityId: string,
  ) => Promise<{ error?: string; message?: string; verifyToken?: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function onStart() {
    setMsg(null)
    setErr(null)
    start(async () => {
      const res = await startAction(target.entityType, target.entityId)
      if (res.error) {
        setErr(res.error)
        return
      }
      setMsg(res.message ?? null)
      if (res.verifyToken) setToken(res.verifyToken)
      // Refresh so /me/listings reflects a new claim or a granted listing when
      // the user heads back.
      router.refresh()
    })
  }

  const how = target.isSelfSubmitted
    ? 'You submitted this field, so claiming it makes you its owner right away.'
    : target.repoUrl
      ? 'This tool has a GitHub repo, so you can prove ownership by committing a token to it.'
      : target.alreadyOwned
        ? 'Someone already manages this listing, so your claim goes to a person to review.'
        : 'We cannot verify this one automatically, so your claim goes to a person to review.'

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-5">
      <p className="text-sm text-muted-2">{entityNoun(target.entityType)}</p>
      <h2 className="mt-1 text-lg font-semibold text-foreground">{target.facts.title}</h2>
      {target.facts.subtitle && <p className="mt-1 text-sm text-muted">{target.facts.subtitle}</p>}

      <p className="mt-4 text-sm text-muted">{how}</p>

      {!token && (
        <button
          type="button"
          onClick={onStart}
          disabled={pending}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
        >
          {pending ? 'Working…' : 'Claim this listing'}
        </button>
      )}

      {token && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm text-muted">
            Add a file named <code className="rounded bg-surface-2 px-1 py-0.5 text-foreground">{verifyFilename}</code>{' '}
            containing this token to the default branch of your repo, then finish the check on your
            listings page.
          </p>
          <code className="block break-all rounded-md border border-border-subtle bg-surface-2 p-2 text-xs text-foreground">
            {token}
          </code>
        </div>
      )}

      {msg && !token && <p className="mt-3 text-sm text-muted">{msg}</p>}
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
