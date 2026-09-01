'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { claimStatusLabel, entityNoun, methodLabel } from './listing-labels'
import type { UserClaim } from '@/lib/queries/listing-ownership'

/**
 * A user's own claims and how to move them forward.
 *
 * A repo_file claim shows the token to commit and a "Check now" button that
 * runs the server-side fetch. Everything else is a status line: a claim held
 * for review is not something the user can push, only wait on, so the UI says
 * that plainly rather than dangling a button that does nothing.
 */
export function PendingClaims({
  claims,
  verifyFilename,
  verifyAction,
}: {
  claims: UserClaim[]
  verifyFilename: string
  verifyAction: (claimId: string) => Promise<{ error?: string; message?: string }>
}) {
  if (claims.length === 0) return null
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">Claims in progress</h2>
      <ul className="mt-4 flex flex-col gap-3">
        {claims.map((c) => (
          <ClaimCard key={c.id} claim={c} verifyFilename={verifyFilename} verifyAction={verifyAction} />
        ))}
      </ul>
    </section>
  )
}

function ClaimCard({
  claim,
  verifyFilename,
  verifyAction,
}: {
  claim: UserClaim
  verifyFilename: string
  verifyAction: (claimId: string) => Promise<{ error?: string; message?: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function onCheck() {
    setMsg(null)
    setErr(null)
    start(async () => {
      const res = await verifyAction(claim.id)
      if (res.error) setErr(res.error)
      else {
        setMsg(res.message ?? 'Done.')
        router.refresh()
      }
    })
  }

  const title = claim.facts?.title ?? `${entityNoun(claim.entityType)} listing`

  return (
    <li className="rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-2">
          {entityNoun(claim.entityType)} · {claimStatusLabel(claim.status)}
        </span>
      </div>

      {claim.verifyToken ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-muted">
            Add a file named <code className="rounded bg-surface-2 px-1 py-0.5 text-foreground">{verifyFilename}</code>{' '}
            containing this token to the default branch of{' '}
            {claim.repoUrl ? (
              <a href={claim.repoUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                the repo
              </a>
            ) : (
              'the repo'
            )}
            , then check it.
          </p>
          <code className="block break-all rounded-md border border-border-subtle bg-surface-2 p-2 text-xs text-foreground">
            {claim.verifyToken}
          </code>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCheck}
              disabled={pending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
            >
              {pending ? 'Checking…' : 'Check now'}
            </button>
            {msg && <span className="text-sm text-muted">{msg}</span>}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {methodLabel(claim.method)}.{' '}
          {claim.status === 'pending'
            ? 'An admin will review this. Nothing more for you to do right now.'
            : null}
        </p>
      )}

      {err && (
        <p role="alert" className="mt-3 text-sm text-frc">
          {err}
        </p>
      )}
    </li>
  )
}
