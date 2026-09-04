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
 * or event you submitted, a repo token for a tool with a GitHub repo, a wait for
 * a human otherwise. Honesty here is the point, because a claim that quietly does
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
  claimToken,
}: {
  target: ClaimableListing
  verifyFilename: string
  startAction: (
    entityType: string,
    entityId: string,
    note?: string,
    outreachToken?: string,
  ) => Promise<{ error?: string; message?: string; verifyToken?: string; granted?: boolean }>
  /** The signed outreach token from the email link, when the reader arrived that way. */
  claimToken?: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  // Seeded from the server, so an open claim survives a reload. Set on a
  // successful submit too, which is what swaps the card over without one.
  const [claimed, setClaimed] = useState(target.existingClaim !== null)
  const [granted, setGranted] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(target.existingClaim?.token ?? null)
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
      const res = await startAction(target.entityType, target.entityId, undefined, claimToken)
      if (res.error) {
        setErr(res.error)
        return
      }
      setMsg(res.message ?? null)
      if (res.verifyToken) setToken(res.verifyToken)
      if (res.granted) setGranted(true)
      // The card becomes a receipt. Leaving the form up invited a second
      // request for a claim that is already open; the action refuses one, but
      // the button should not have been there to press.
      setClaimed(true)
      // Refresh so /me/listings reflects a new claim or a granted listing when
      // the user heads back.
      router.refresh()
    })
  }

  const { user } = useSession()

  // Arrived from the outreach email we sent the organiser: the click grants the
  // listing on the spot, so the copy promises that rather than a review.
  const invited = Boolean(claimToken) && !target.alreadyOwned
  const how = invited
    ? 'We emailed you this listing, so claiming it makes it yours right away.'
    : path === 'self'
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

      {/* The #1 reassurance. People hesitate to claim with a personal address
          because they assume it will end up on the public page. It never does:
          an owner's email is only ever used to reach them, and no public page
          renders it. Saying so here is what makes claiming with a real address
          feel safe. */}
      <p className="mt-3 rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs text-muted">
        Your email is used only so the site and the other people who manage this listing can reach
        you. It is never shown on the public listing.
      </p>

      {claimed ? (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
            <span className="text-sm font-medium text-foreground">
              {granted ? 'You manage this listing' : token ? 'Waiting on your repo' : 'Claim submitted'}
            </span>
          </div>
          {granted ? (
            <p className="text-sm text-muted">
              {msg ?? 'This listing is yours now.'} You can edit it from your listings.
            </p>
          ) : token ? (
            <>
              <p className="text-sm text-muted">
                Add a file named{' '}
                <code className="rounded bg-surface-2 px-1 py-0.5 text-foreground">{verifyFilename}</code>{' '}
                containing this token to your default branch, then finish the check on your listings
                page.
              </p>
              <code className="block break-all rounded-md border border-border-subtle bg-surface-2 p-2 text-xs text-foreground">
                {token}
              </code>
            </>
          ) : (
            <p className="text-sm text-muted">
              A reviewer will look at your claim
              {user?.email ? `, and we'll email ${user.email} when it's decided` : ''}.
            </p>
          )}
        </div>
      ) : (
        <>
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

        </>
      )}

      {/* The claimed block already shows the confirmation; only surface a raw msg
          before a claim is submitted (a status or a soft error). */}
      {msg && !token && !claimed && <p className="mt-3 text-sm text-muted">{msg}</p>}
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
