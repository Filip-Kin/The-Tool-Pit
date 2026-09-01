import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { UserMenu } from '@/components/auth/user-menu'
import { MobileNav } from '@/components/layout/mobile-nav'
import { VerticalHomeCrumb, verticalNavItems } from '@/components/layout/vertical-switcher'

export async function FieldsHeader() {
  return (
    <header className="sticky top-0 z-[500] border-b border-border-subtle bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <VerticalHomeCrumb current="fields" />

        <Link href="/" className="flex shrink-0 items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <span className="whitespace-nowrap text-lg font-bold tracking-tight text-foreground">
            <span className="hidden sm:inline">Practice Field Map</span>
            <span className="sm:hidden">Fields</span>
          </span>
        </Link>


        <nav className="ml-auto flex items-center gap-2">
          {/* Below sm the call to action moves into the hamburger: this
              wordmark is long and the bar was overflowing on a phone. */}
          <Link
            href="/fields/submit"
            className="hidden shrink-0 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover sm:block"
          >
            Add a field
          </Link>
          <UserMenu />
          <MobileNav
            className="sm:hidden"
            items={[
              ...(await verticalNavItems('fields')),
              { href: '/fields/submit', label: 'Add a field', primary: true },
            ]}
          />
        </nav>
      </div>
    </header>
  )
}
