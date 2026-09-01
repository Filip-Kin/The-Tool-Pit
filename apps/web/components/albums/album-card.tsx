import { ExternalLink, Camera, Images, Calendar } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FavoriteButton } from '@/components/auth/favorite-button'
import type { AlbumDTO } from '@the-tool-pit/types'
import type { ListingClaimState } from '@/lib/queries/listing-ownership'
import { providerLabel } from './format'
import { AlbumMenu } from './album-menu'

export function AlbumCard({
  album,
  claimState,
  favorited,
}: {
  album: AlbumDTO
  claimState: ListingClaimState
  favorited: boolean
}) {
  const title = album.title || providerLabel(album.provider)
  // The card used to BE the link. Controls cannot live inside an anchor (a
  // button inside a link is invalid, and every click would navigate away
  // instead), so the anchor covers the image and the text, and the footer row
  // sits below it. The group class stays on the outer element so the hover
  // treatment still covers the whole card.
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-primary/50">
      <a
        href={album.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-1 flex-col"
      >
        {/* Stretched link, the pattern tool-card already uses: the anchor
            covers the whole tile so the controls can live on the title row
            without being nested inside it, which is invalid and would navigate
            on every click. */}
        <span className="absolute inset-0 z-0" aria-hidden />
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

        {/* Title, details and controls share one row. The controls used to sit
            on a line of their own below the details, which added an empty band
            to every card for the sake of two small buttons. */}
        <div className="flex flex-1 items-start justify-between gap-2 p-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
              {title}
              <ExternalLink className="ml-1.5 inline h-3.5 w-3.5 shrink-0 align-baseline text-muted-2 group-hover:text-primary" />
            </h3>
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

          {/* Above the stretched link, so a click here does not open the album. */}
          <div className="relative z-10 flex shrink-0 items-center gap-0.5">
            <FavoriteButton
              entityType="album"
              entityId={album.id}
              initialFavorited={favorited}
              reason="Sign in to save this album to your home page"
            />
            <AlbumMenu albumId={album.id} albumUrl={album.url} claimState={claimState} />
          </div>
        </div>
      </a>
    </div>
  )
}
