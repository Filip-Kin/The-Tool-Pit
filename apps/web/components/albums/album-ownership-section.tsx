import type { AlbumDTO } from '@the-tool-pit/types'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { claimAffordance } from '@/lib/listings/claim-affordance'
import { ClaimListingButton } from '@/components/auth/claim-listing-button'
import { providerLabel } from './format'

export interface AlbumOwnershipRow {
  album: AlbumDTO
  /** Division heading the album sits under, when the page splits by division. */
  groupLabel: string | null
}

/**
 * The ownership list under a multi-album event page.
 *
 * The card menu is fine when you already know which card is yours, but a
 * championship page carries up to eight albums across a parent event and its
 * divisions, and finding your own means opening menu after menu. This is the
 * same set of controls laid out as one labelled row per album, so the album
 * each control belongs to is written next to it.
 *
 * Renders nothing when no album on the page offers the visitor anything, which
 * is every signed-out visit. An empty "Album ownership" heading would only be
 * asking people to sign in to see a thing they cannot use.
 */
export function AlbumOwnershipSection({
  rows,
  claimStates,
}: {
  rows: AlbumOwnershipRow[]
  claimStates: ReadonlyMap<string, ListingClaimState>
}) {
  const shown = rows
    .map((r) => ({ ...r, state: claimStates.get(r.album.id) ?? ('signed_out' as ListingClaimState) }))
    .filter((r) => claimAffordance('album', r.album.id, r.state))
  if (shown.length === 0) return null

  return (
    <section className="mt-12 rounded-lg border border-border-subtle bg-surface p-5">
      <h2 className="text-base font-semibold text-foreground">Album ownership</h2>
      <p className="mt-1 text-sm text-muted">
        Claim an album you shot to keep its title, link and photographer credit right.
      </p>
      <ul className="mt-4 flex flex-col divide-y divide-border-subtle">
        {shown.map(({ album, groupLabel, state }) => {
          const subtitle = [album.photographer, groupLabel].filter(Boolean).join(' · ')
          return (
            <li
              key={album.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {album.title || providerLabel(album.provider)}
                </p>
                {subtitle && <p className="truncate text-xs text-muted-2">{subtitle}</p>}
              </div>
              <ClaimListingButton entityType="album" entityId={album.id} state={state} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
