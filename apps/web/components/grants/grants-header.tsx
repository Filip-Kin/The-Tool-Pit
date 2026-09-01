import Link from 'next/link'
import { CircleDollarSign } from 'lucide-react'
import { UserMenu } from '@/components/auth/user-menu'
import { MobileNav } from '@/components/layout/mobile-nav'
import { VerticalHomeCrumb } from '@/components/layout/vertical-switcher'

/**
 * Grants chrome. Same slots and the same order as the fields and photos
 * headers: wordmark, vertical switcher, the one call to action, account menu.
 *
 * Every href here is root-relative because the middleware rewrites the whole
 * path tree onto grants.*, so `/submit` is this vertical's submit page on the
 * subdomain and the vertical switcher is the only thing that crosses hosts.
 */
export function GrantsHeader() {
  return (
    <header className="sticky top-0 z-[500] border-b border-border-subtle bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <VerticalHomeCrumb current="grants" />

        <Link href="/" className="flex shrink-0 items-center gap-2">
          <CircleDollarSign className="h-5 w-5 text-primary" />
          <span className="whitespace-nowrap text-lg font-bold tracking-tight text-foreground">Grants</span>
        </Link>


        <nav className="ml-auto flex items-center gap-2">
          {/* Below sm the call to action moves into the hamburger: this
              wordmark is long and the bar was overflowing on a phone. */}
          <Link
            href="/grants/submit"
            className="hidden shrink-0 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover sm:block"
          >
            Submit a grant
          </Link>
          <UserMenu />
          <MobileNav
            className="sm:hidden"
            items={[
              { href: '/', label: 'Grants' },
              { href: '/photos', label: 'Event Photos' },
              { href: '/fields', label: 'Practice Fields' },
              { href: '/grants', label: 'Grants' },
              { href: '/submit', label: 'Submit a grant', primary: true },
            ]}
          />
        </nav>
      </div>
    </header>
  )
}
