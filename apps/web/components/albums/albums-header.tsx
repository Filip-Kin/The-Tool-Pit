import Link from 'next/link'
import { Camera } from 'lucide-react'
import { AlbumSearchBar } from './album-search-bar'

export function AlbumsHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border-subtle bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold tracking-tight text-foreground">The Photo Pit</span>
        </Link>

        <div className="hidden flex-1 md:block max-w-md">
          <AlbumSearchBar size="sm" placeholder="Search events or a team number…" />
        </div>

        <nav className="ml-auto flex items-center gap-1">
          <Link
            href="/submit"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Submit album
          </Link>
        </nav>
      </div>
    </header>
  )
}
