import Link from 'next/link'
import { ExternalLink, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { entityNoun, roleLabel } from './listing-labels'
import type { OwnedListing } from '@/lib/queries/listing-ownership'

/**
 * The listings a signed-in user manages: what each one is, the page everybody
 * else sees, and the way in to edit it. Ownership itself is resolved
 * server-side off listing_owners, so this component only ever renders rows the
 * user genuinely has a permission row for.
 *
 * A SERVER COMPONENT AGAIN. It was a client one only to carry Leave, and Leave
 * has moved to the bottom of the listing's own edit page: a destructive action
 * had no business sitting beside Edit on the list of everything you run, one
 * slip away from the button people actually come here for.
 *
 * What replaced it is the thing that was missing. There was no way from here to
 * the public page, so the only way to check how an edit came out was to
 * remember the URL.
 */
export function OwnedListings({ listings }: { listings: OwnedListing[] }) {
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
            <Row key={`${l.entityType}:${l.entityId}`} listing={l} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Row({ listing }: { listing: OwnedListing }) {
  // An album has no page of ours: facts.href is the gallery on the
  // photographer's own host. So the public link opens in a new tab for every
  // vertical rather than for some of them, because "View" behaving one way on
  // one row and another way on the next is the kind of near-miss that makes the
  // list feel assembled rather than built.
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

      <a
        href={listing.facts.href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        View
        <span className="sr-only"> the public page for {listing.facts.title}</span>
      </a>

      {listing.canEdit && (
        <Link
          href={`/me/listings/${listing.entityType}/${listing.entityId}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit
          <span className="sr-only"> {listing.facts.title}</span>
        </Link>
      )}
    </li>
  )
}
