import Link from 'next/link'
import { Banknote } from 'lucide-react'
import { UserMenu } from '@/components/auth/user-menu'
import { VerticalSwitcher } from '@/components/layout/vertical-switcher'

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
      <div className="container mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Banknote className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold tracking-tight text-foreground">Grants</span>
        </Link>

        <VerticalSwitcher current="grants" className="hidden sm:flex" />

        <nav className="ml-auto flex items-center gap-2">
          <Link
            href="/submit"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Submit a grant
          </Link>
          <UserMenu />
        </nav>
      </div>
    </header>
  )
}
