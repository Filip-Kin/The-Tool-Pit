'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/components/auth/session-provider'
import { entityNoun } from './listing-labels'
import type { ClaimableListing } from '@/lib/queries/listing-ownership'

/**
 * Start a claim on a specific listing the user reached from its public page.
 *
 * The button explains what will happen before it happens: instant for a field
 * you submitted, a repo token for a tool with a GitHub repo, a wait for a human
 * otherwise. Honesty here is the point, because a claim that quietly does
 * nothing is how people conclude the feature is broken.
 *
 * The review path asks for evidence in writing before it will send anything.
 * The server enforces that too; this only saves the round trip and tells the
 * person what a reviewer needs from them.
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
    note?: string,
  ) => Promise<{ error?: string; message?: string; verifyToken?: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  // Which of the three paths this listing takes, worked out the same way the
  // server does it, so the page never promises a path the action will not use.
  // An existing owner outranks both automatic proofs: it makes the claim a
  // dispute, and a dispute is always a person's decision.
  const path = target.alreadyOwned
    ? 'review'
    : target.isSelfSubmitted
      ? 'self'
      : target.repoUrl
        ? 'repo'
        : 'review'

  function onStart() {
    setMsg(null)
    setErr(null)
    start(async () => {
      const res = await startAction(target.entityType, target.entityId, note.trim() || undefined)
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

  const { user } = useSession()

  const how =
    path === 'self'
      ? 'You submitted this, so it becomes yours right away.'
      : path === 'repo'
        ? 'Prove it by committing a token to the repo.'
        : target.alreadyOwned
          ? 'Someone already manages this listing. A reviewer decides.'
          : 'Reviewed by hand.'

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-5">
      <p className="text-sm text-muted-2">{entityNoun(target.entityType)}</p>
      <h2 className="mt-1 text-lg font-semibold text-foreground">{target.facts.title}</h2>
      {target.facts.subtitle && <p className="mt-1 text-sm text-muted">{target.facts.subtitle}</p>}

      <p className="mt-4 text-sm text-muted">{how}</p>

      {path === 'review' && !token && (
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">
            Your connection to it<span className="text-frc"> *</span>
          </span>
          {/* The single most useful thing a claimant can do is point at
              something public that already names them, and the account email
              is usually it. Saying which address the reviewer will see turns a
              vague "prove it" box into a concrete one: people recognise their
              own address in a site footer or a repo commit. */}
          <span className="text-xs text-muted-2">
            {user?.email
              ? `Sent as ${user.email}. Point at somewhere public that shows the same address, or anything else a reviewer can check.`
              : 'Point at somewhere public a reviewer can check.'}
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="This address is listed as the contact on the site footer."
            className="input"
          />
        </label>
      )}

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
