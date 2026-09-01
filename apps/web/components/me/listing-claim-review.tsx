'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { entityNoun, methodLabel, roleLabel } from './listing-labels'
import type { AdminClaim } from '@/lib/queries/listing-ownership'

/**
 * Admin review of pending claims.
 *
 * Only rendered for a user whose isAdmin flag is set in the database (never a
 * Firebase claim). This is the override that resolves a dispute and unsticks
 * the "first person owns it, everyone else is stuck" case: an admin can approve
 * a claim even on an already-owned listing, which adds the claimant as an
 * owner rather than silently switching control.
 */
export function ListingClaimReview({
  claims,
  resolveAction,
}: {
  claims: AdminClaim[]
  resolveAction: (
    claimId: string,
    approve: boolean,
    note: string | null,
  ) => Promise<{ error?: string; message?: string }>
}) {
  if (claims.length === 0) return null
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">
        Claims to review
        <span className="ml-2 text-sm font-normal text-muted-2">{claims.length}</span>
      </h2>
      <ul className="mt-4 flex flex-col gap-3">
        {claims.map((c) => (
          <ReviewCard key={c.id} claim={c} resolveAction={resolveAction} />
        ))}
      </ul>
    </section>
  )
}

function ReviewCard({
  claim,
  resolveAction,
}: {
  claim: AdminClaim
  resolveAction: (
    claimId: string,
    approve: boolean,
    note: string | null,
  ) => Promise<{ error?: string; message?: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  function resolve(approve: boolean) {
    setErr(null)
    start(async () => {
      const res = await resolveAction(claim.id, approve, note.trim() || null)
      if (res.error) setErr(res.error)
      else router.refresh()
    })
  }

  return (
    // id: the Discord notice for a claim links straight to this card.
    <li id={`claim-${claim.id}`} className="scroll-mt-6 rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-foreground">{claim.facts?.title ?? 'Listing'}</span>
        <span className="text-xs text-muted-2">
          {entityNoun(claim.entityType)} · {methodLabel(claim.method)}
        </span>
      </div>

      <p className="mt-2 text-sm text-muted">
        Claimed by {claim.claimantName ?? claim.claimantEmail ?? 'a user'}
        {claim.claimantName && claim.claimantEmail ? ` (${claim.claimantEmail})` : ''}.
      </p>
      {claim.note && <p className="mt-1 text-sm text-muted-2">Note: {claim.note}</p>}

      {claim.currentOwners.length > 0 && (
        <p className="mt-2 text-sm text-amber-400">
          Already managed by{' '}
          {claim.currentOwners
            .map((o) => `${o.displayName ?? o.email ?? 'someone'} (${roleLabel(o.role)})`)
            .join(', ')}
          . Approving adds this claimant as an owner too.
        </p>
      )}

      {/* Optional on an approval, required on a rejection. Approving explains
          itself: the claimant can see they now manage the listing. A rejection
          explains nothing on its own, and this text is the body of the email
          they get, so Reject stays disabled until it is written. */}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note. Optional to approve, required to reject."
        className="input mt-3"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => resolve(true)}
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => resolve(false)}
          disabled={pending || !note.trim()}
          title={note.trim() ? 'Turn this claim down' : 'Write a reason first'}
          className="rounded-md border border-border-subtle px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground disabled:opacity-40"
        >
          Reject
        </button>
      </div>

      {err && (
        <p role="alert" className="mt-3 text-sm text-frc">
          {err}
        </p>
      )}
    </li>
  )
}
