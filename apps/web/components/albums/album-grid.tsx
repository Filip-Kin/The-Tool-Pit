import type { AlbumDTO } from '@the-tool-pit/types'
import { AlbumCard } from './album-card'

export function AlbumGrid({ albums }: { albums: AlbumDTO[] }) {
  if (albums.length === 0) {
    return <p className="text-sm text-muted">No albums yet for this event.</p>
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {albums.map((a) => (
        <AlbumCard key={a.id} album={a} />
      ))}
    </div>
  )
}
