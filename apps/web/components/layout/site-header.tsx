import Link from 'next/link'
import { Suspense } from 'react'
import { ButtonLink } from '@/components/ui/button'
import { SearchBar } from '@/components/search/search-bar'
import { UserMenu } from '@/components/auth/user-menu'
import { MobileNav } from './mobile-nav'
import { verticalNavItems } from './vertical-switcher'

export async function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border-subtle bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="whitespace-nowrap text-lg font-bold tracking-tight text-foreground">
            The Tool Pit
          </span>
        </Link>

        {/* Search, hidden on small screens, shown on md+ */}
        <div className="hidden flex-1 md:block max-w-sm">
          <Suspense>
            <SearchBar placeholder="Search tools…" size="sm" />
          </Suspense>
        </div>

        {/* Nav. Below lg the links move into the hamburger: five of them plus a
            wordmark and an account menu do not fit on a phone, and they were
            overflowing the bar rather than wrapping. */}
        <nav className="ml-auto flex items-center gap-1">
          <div className="hidden items-center gap-1 lg:flex">
            <NavLink href="/frc" label="FRC" color="var(--color-frc)" />
            <NavLink href="/ftc" label="FTC" color="var(--color-ftc)" />
            <NavLink href="/fll" label="FLL" color="var(--color-fll)" />
            <ButtonLink href="/submit" size="sm" className="ml-2">
              Submit
            </ButtonLink>
          </div>
          <div className="ml-2">
            <UserMenu />
          </div>
          <MobileNav
            className="ml-1 lg:hidden"
            items={[
              { href: '/frc', label: 'FRC' },
              { href: '/ftc', label: 'FTC' },
              { href: '/fll', label: 'FLL' },
              ...(await verticalNavItems('tools')),
              { href: '/submit', label: 'Submit a tool', primary: true },
            ]}
          />
        </nav>
      </div>
    </header>
  )
}

function NavLink({ href, label, color }: { href: string; label: string; color: string }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
      style={{ '--link-color': color } as React.CSSProperties}
    >
      {label}
    </Link>
  )
}
