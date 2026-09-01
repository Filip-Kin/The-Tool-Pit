import Link from 'next/link'
import { CalendarDays } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { UserMenu } from '@/components/auth/user-menu'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { MobileNav } from '@/components/layout/mobile-nav'
import { VerticalHomeCrumb, verticalNavItems } from '@/components/layout/vertical-switcher'

/**
 * Offseason events chrome. Same slots and order as the other verticals'
 * headers: home crumb, wordmark, the one call to action, account menu.
 *
 * Links are prefixed with /events, not root-relative: the verticals are PATHS
 * on one host now, so a bare "/submit" would resolve against the tools host and
 * 404. The wordmark points at /events (this vertical's home), and the home
 * crumb is the way back out to frc.tools.
 */
export async function EventsHeader() {
  return (
    <header className="sticky top-0 z-[500] border-b border-border-subtle bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <VerticalHomeCrumb current="events" />

        <Link href="/events" className="flex shrink-0 items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <span className="whitespace-nowrap text-lg font-bold tracking-tight text-foreground">
            <span className="hidden sm:inline">Off-Season Events</span>
            <span className="sm:hidden">Offseason</span>
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-2">
          <ButtonLink
            href="/events/submit"
            size="sm"
            className="hidden sm:inline-flex"
          >
            Add an event
          </ButtonLink>
          <ThemeToggle />
          <UserMenu />
          <MobileNav
            className="sm:hidden"
            items={[
              ...(await verticalNavItems('events')),
              { href: '/events/submit', label: 'Add an event', primary: true },
            ]}
          />
        </nav>
      </div>
    </header>
  )
}
