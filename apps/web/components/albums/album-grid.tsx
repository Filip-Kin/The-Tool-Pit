import type { AlbumDTO } from '@the-tool-pit/types'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { AlbumCard } from './album-card'

/**
 * Takes the per-card state rather than resolving it, which is where ToolGrid
 * does its own lookup. An event page draws one grid for the event and one more
 * for every division, so resolving per grid would put two queries behind each
 * heading. One resolve at the top of the page, passed down.
 */
export function AlbumGrid({
  albums,
  claimStates,
  favorited,
}: {
  albums: AlbumDTO[]
  claimStates: ReadonlyMap<string, ListingClaimState>
  favorited: ReadonlySet<string>
}) {
  if (albums.length === 0) {
    return <p className="text-sm text-muted">No albums yet for this event.</p>
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {albums.map((a) => (
        <AlbumCard
          key={a.id}
          album={a}
          claimState={claimStates.get(a.id) ?? 'signed_out'}
          favorited={favorited.has(a.id)}
        />
      ))}
    </div>
  )
}
