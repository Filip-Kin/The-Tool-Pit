import Link from 'next/link'
import { Camera } from 'lucide-react'
import { AlbumSearchBar } from './album-search-bar'
import { ButtonLink } from '@/components/ui/button'
import { UserMenu } from '@/components/auth/user-menu'
import { MobileNav } from '@/components/layout/mobile-nav'
import { VerticalHomeCrumb, verticalNavItems } from '@/components/layout/vertical-switcher'

export async function AlbumsHeader() {
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
          <ButtonLink
            href="/photos/submit"
            size="sm"
            className="hidden sm:inline-flex"
          >
            Submit album
          </ButtonLink>
          <UserMenu />
          <MobileNav
            className="sm:hidden"
            items={[
              ...(await verticalNavItems('photos')),
              { href: '/photos/submit', label: 'Submit album', primary: true },
            ]}
          />
        </nav>
      </div>
    </header>
  )
}
