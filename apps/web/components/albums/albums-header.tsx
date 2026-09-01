import Link from 'next/link'
import { Camera } from 'lucide-react'
import { AlbumSearchBar } from './album-search-bar'
import { UserMenu } from '@/components/auth/user-menu'
import { MobileNav } from '@/components/layout/mobile-nav'
import { VerticalHomeCrumb } from '@/components/layout/vertical-switcher'

export function AlbumsHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border-subtle bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <VerticalHomeCrumb current="photos" />

        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          <span className="whitespace-nowrap text-lg font-bold tracking-tight text-foreground">
            <span className="hidden sm:inline">FIRST Event Photos</span>
            <span className="sm:hidden">Photos</span>
          </span>
        </Link>


        <div className="hidden flex-1 md:block max-w-md">
          <AlbumSearchBar size="sm" placeholder="Search events or a team number…" />
        </div>

        <nav className="ml-auto flex items-center gap-2">
          {/* Below sm the call to action moves into the hamburger: this
              wordmark is long and the bar was overflowing on a phone. */}
          <Link
            href="/photos/submit"
            className="hidden shrink-0 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover sm:block"
          >
            Submit album
          </Link>
          <UserMenu />
          <MobileNav
            className="sm:hidden"
            items={[
              { href: '/', label: 'FIRST Event Photos' },
              { href: '/photos', label: 'Event Photos' },
              { href: '/fields', label: 'Practice Fields' },
              { href: '/grants', label: 'Grants' },
              { href: '/submit', label: 'Submit album', primary: true },
            ]}
          />
        </nav>
      </div>
    </header>
  )
}
