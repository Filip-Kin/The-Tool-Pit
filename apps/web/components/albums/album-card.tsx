import { ExternalLink, Camera, Images, Calendar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { AlbumDTO } from '@the-tool-pit/types'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { providerLabel } from './format'
import { AlbumMenu } from './album-menu'

export function AlbumCard({ album, claimState }: { album: AlbumDTO; claimState: ListingClaimState }) {
  const title = album.title || providerLabel(album.provider)
  // The card used to BE the link. The overflow menu cannot live inside an
  // anchor (a button inside a link is invalid, and every click would navigate
  // away before the menu opened), so the anchor now covers the card content and
  // the menu sits beside it. The group class stays on the outer element so the
  // hover treatment still covers the whole card.
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-primary/50">
      <a
        href={album.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-1 flex-col"
      >
        <div className="relative aspect-[3/2] w-full overflow-hidden bg-surface-2">
          {album.coverImageUrl ? (
            // Cover images live on many photographer-owned hosts; use a plain img
            // (lazy-loaded) rather than next/image to avoid remote-host config churn.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={album.coverImageUrl}
              alt={title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-2">
              <Images className="h-10 w-10" />
            </div>
          )}
          <span className="absolute left-2 top-2">
            <Badge variant="program">{providerLabel(album.provider)}</Badge>
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-1 p-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
              {title}
            </h3>
            <ExternalLink className="h-4 w-4 shrink-0 text-muted-2 group-hover:text-primary" />
          </div>
          {album.photographer && (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Camera className="h-3 w-3 shrink-0" />
              {album.photographer}
            </span>
          )}
          {album.dateText && (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Calendar className="h-3 w-3 shrink-0" />
              {album.dateText}
            </span>
          )}
          {album.photoCount != null && (
            <span className="text-xs text-muted-2">{album.photoCount} photos</span>
          )}
        </div>
      </a>

      {/* Always shown, not hover-only: a touch screen has no hover, and this is
          the only route a photographer has to their own album. */}
      <div className="absolute right-2 top-2">
        <AlbumMenu albumId={album.id} albumUrl={album.url} claimState={claimState} />
      </div>
    </div>
  )
}
