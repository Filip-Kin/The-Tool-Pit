import Link from 'next/link'
import { Code2 } from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { UserMenu } from '@/components/auth/user-menu'
import { VerticalHomeCrumb, verticalNavItems } from '@/components/layout/vertical-switcher'
import { MobileNav } from '@/components/layout/mobile-nav'

/**
 * Robot Code / CAD chrome. Same slots and the same order as the grants, fields
 * and photos headers: back to the main site, wordmark, the one call to action,
 * account menu.
 */
export async function RobotCodeHeader() {
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
          <ButtonLink
            href="/robot-code/submit"
            size="sm"
            className="hidden sm:inline-flex"
          >
            Add your team
          </ButtonLink>
          <UserMenu />
          <MobileNav
            className="sm:hidden"
            items={[
              ...(await verticalNavItems('code')),
              { href: '/robot-code/submit', label: 'Add your team', primary: true },
            ]}
          />
        </nav>
      </div>
    </header>
  )
}
