import Link from 'next/link'
import { Code2 } from 'lucide-react'
import { UserMenu } from '@/components/auth/user-menu'
import { VerticalHomeCrumb } from '@/components/layout/vertical-switcher'
import { MobileNav } from '@/components/layout/mobile-nav'

/**
 * Robot Code / CAD chrome. Same slots and the same order as the grants, fields
 * and photos headers: back to the main site, wordmark, the one call to action,
 * account menu.
 */
export function RobotCodeHeader() {
  return (
    <header className="sticky top-0 z-[500] border-b border-border-subtle bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <VerticalHomeCrumb current="code" />

        <Link href="/robot-code" className="flex shrink-0 items-center gap-2">
          <Code2 className="h-5 w-5 text-primary" />
          <span className="whitespace-nowrap text-lg font-bold tracking-tight text-foreground">
            <span className="hidden sm:inline">Robot Code / CAD</span>
            <span className="sm:hidden">Code / CAD</span>
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-2">
          <Link
            href="/robot-code/submit"
            className="hidden shrink-0 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover sm:block"
          >
            Add your team
          </Link>
          <UserMenu />
          <MobileNav
            className="sm:hidden"
            items={[
              { href: '/', label: 'Tools directory' },
              { href: '/photos', label: 'Event Photos' },
              { href: '/fields', label: 'Practice Fields' },
              { href: '/grants', label: 'Grants' },
              { href: '/submit', label: 'Add your team', primary: true },
            ]}
          />
        </nav>
      </div>
    </header>
  )
}
