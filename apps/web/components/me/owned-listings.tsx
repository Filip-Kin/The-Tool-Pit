'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { entityNoun, roleLabel } from './listing-labels'
import type { OwnedListing } from '@/lib/queries/listing-ownership'

/**
 * The listings a signed-in user manages, with a link to edit each and a way to
 * step back from one. Ownership itself is resolved server-side off
 * listing_owners, so this component only ever renders rows the user genuinely
 * has a permission row for.
 */
export function OwnedListings({
  listings,
  leaveAction,
}: {
  listings: OwnedListing[]
  leaveAction: (
    entityType: string,
    entityId: string,
    targetUserId: string,
  ) => Promise<{ error?: string; message?: string }>
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">
        Listings you manage
        {listings.length > 0 && <span className="ml-2 text-sm font-normal text-muted-2">{listings.length}</span>}
      </h2>

      {listings.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border-subtle bg-surface p-4 text-sm text-muted">
          You do not manage any listings yet. Open a tool, album, practice field or off-season event
          you run and use &ldquo;Claim this listing&rdquo; to start.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {listings.map((l) => (
            <Row key={`${l.entityType}:${l.entityId}`} listing={l} leaveAction={leaveAction} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Row({
  listing,
  leaveAction,
}: {
  listing: OwnedListing
  leaveAction: (
    entityType: string,
    entityId: string,
    targetUserId: string,
  ) => Promise<{ error?: string; message?: string }>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function onLeave() {
    setErr(null)
    // Passing the empty string as the target means "me": the action reads the
    // signed-in user for a self-removal, so no client-held user id is trusted.
    start(async () => {
      const res = await leaveAction(listing.entityType, listing.entityId, '__self__')
      if (res.error) setErr(res.error)
      else router.refresh()
    })
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{listing.facts.title}</span>
          <Badge variant="muted">{roleLabel(listing.role)}</Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-2">
          {entityNoun(listing.entityType)}
          {listing.facts.subtitle ? ` · ${listing.facts.subtitle}` : ''}
        </p>
      </div>

      {listing.canEdit && (
        <Link
          href={`/me/listings/${listing.entityType}/${listing.entityId}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Link>
      )}
      <button
        type="button"
        onClick={onLeave}
        disabled={pending}
        className="rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
      >
        Leave
      </button>

      {err && (
        <p role="alert" className="w-full text-sm text-frc">
          {err}
        </p>
      )}
    </li>
  )
}
