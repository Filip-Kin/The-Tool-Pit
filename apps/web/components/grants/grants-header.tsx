import Link from 'next/link'
import { CircleDollarSign } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { UserMenu } from '@/components/auth/user-menu'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { MobileNav } from '@/components/layout/mobile-nav'
import { VerticalHomeCrumb, verticalNavItems } from '@/components/layout/vertical-switcher'

/**
 * Grants chrome. Same slots and the same order as the fields and photos
 * headers: wordmark, vertical switcher, the one call to action, account menu.
 *
 * Every href here is root-relative because the middleware rewrites the whole
 * path tree onto grants.*, so `/submit` is this vertical's submit page on the
 * subdomain and the vertical switcher is the only thing that crosses hosts.
 */
export async function GrantsHeader() {
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
          <ButtonLink
            href="/grants/submit"
            size="sm"
            className="hidden sm:inline-flex"
          >
            Submit a grant
          </ButtonLink>
          <ThemeToggle />
          <UserMenu />
          <MobileNav
            className="sm:hidden"
            items={[
              ...(await verticalNavItems('grants')),
              { href: '/grants/submit', label: 'Submit a grant', primary: true },
            ]}
          />
        </nav>
      </div>
    </header>
  )
}
