'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { entityNoun, roleLabel } from '@/components/me/listing-labels'
import type { ListingEntityType, ListingOwnerRole } from '@the-tool-pit/db'
import {
  adminAddOwnership,
  adminRemoveOwnership,
  adminSearchListings,
  type AdminOwnershipResult,
} from '../actions'
import type { ListingSearchResult } from '@/lib/listings/admin-ownership'

interface OwnedRow {
  entityType: ListingEntityType
  entityId: string
  role: ListingOwnerRole
  title: string
  subtitle: string | null
  href: string
}

/**
 * The manage-ownership surface for one user: the listings they own, each with a
 * Remove, and a name-search picker to grant them a new one at a chosen role.
 * Every button calls an admin-gated server action, then refreshes the server
 * component so the list re-reads listing_owners.
 */
export function OwnershipPanel({ userId, owned }: { userId: string; owned: OwnedRow[] }) {
  return (
    <div className="flex flex-col gap-6">
      <OwnedListings userId={userId} owned={owned} />
      <AddListing userId={userId} />
    </div>
  )
}

function OwnedListings({ userId, owned }: { userId: string; owned: OwnedRow[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">
        Owned listings <span className="text-muted">({owned.length})</span>
      </h2>

      {owned.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
          This user owns no listings.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <ul className="divide-y divide-border-subtle">
            {owned.map((o) => (
              <OwnedRowItem key={`${o.entityType}:${o.entityId}`} userId={userId} row={o} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function OwnedRowItem({ userId, row }: { userId: string; row: OwnedRow }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function remove() {
    setError(null)
    start(async () => {
      const res = await adminRemoveOwnership(row.entityType, row.entityId, userId)
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={row.href}
            target="_blank"
            rel="noreferrer"
            className="truncate font-medium text-foreground hover:text-primary"
          >
            {row.title}
          </a>
          <Badge variant="muted" className="text-[10px]">
            {entityNoun(row.entityType)}
          </Badge>
          <Badge variant="default" className="text-[10px]">
            {roleLabel(row.role)}
          </Badge>
        </div>
        {row.subtitle && <p className="truncate text-xs text-muted-2">{row.subtitle}</p>}
        {error && <p className="text-xs text-frc">{error}</p>}
      </div>
      <Button variant="secondary" size="sm" disabled={pending} onClick={remove}>
        {pending ? '…' : 'Remove'}
      </Button>
    </li>
  )
}

function AddListing({ userId }: { userId: string }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ListingSearchResult[] | null>(null)
  const [role, setRole] = useState<ListingOwnerRole>('owner')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, startSearch] = useTransition()
  const [adding, startAdd] = useTransition()

  function search() {
    const q = query.trim()
    setError(null)
    setMessage(null)
    if (q.length < 2) {
      setResults([])
      return
    }
    startSearch(async () => {
      setResults(await adminSearchListings(q))
    })
  }

  function add(result: ListingSearchResult) {
    setError(null)
    setMessage(null)
    startAdd(async () => {
      const res: AdminOwnershipResult = await adminAddOwnership(
        result.entityType,
        result.entityId,
        userId,
        role,
      )
      if (res.error) {
        setError(res.error)
        return
      }
      setMessage(`Granted ${roleLabel(role)} of ${result.facts.title}.`)
      router.refresh()
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Add a listing</h2>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              search()
            }
          }}
          placeholder="Search listings by name…"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as ListingOwnerRole)}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="owner">Owner</option>
          <option value="editor">Editor</option>
        </select>
        <Button variant="secondary" size="sm" disabled={searching} onClick={search}>
          {searching ? '…' : 'Search'}
        </Button>
      </div>

      {message && <p className="text-xs text-primary">{message}</p>}
      {error && <p className="text-xs text-frc">{error}</p>}

      {results !== null &&
        (results.length === 0 ? (
          <p className="text-sm text-muted">No listings match that search.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <ul className="divide-y divide-border-subtle">
              {results.map((r) => (
                <li
                  key={`${r.entityType}:${r.entityId}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-foreground">{r.facts.title}</span>
                      <Badge variant="muted" className="text-[10px]">
                        {entityNoun(r.entityType)}
                      </Badge>
                    </div>
                    {r.facts.subtitle && (
                      <p className="truncate text-xs text-muted-2">{r.facts.subtitle}</p>
                    )}
                  </div>
                  <Button variant="secondary" size="sm" disabled={adding} onClick={() => add(r)}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  )
}
