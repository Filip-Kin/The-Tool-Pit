import Link from 'next/link'
import { Suspense } from 'react'
import { SearchBar } from '@/components/search/search-bar'
import { cn } from '@/lib/utils/cn'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border-subtle bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-lg font-bold tracking-tight text-foreground">
            The Tool Pit
          </span>
        </Link>

        {/* Search — hidden on small screens, shown on md+ */}
        <div className="hidden flex-1 md:block max-w-sm">
          <Suspense>
            <SearchBar placeholder="Search tools…" size="sm" />
          </Suspense>
        </div>

        {/* Nav */}
        <nav className="ml-auto flex items-center gap-1">
          <NavLink href="/frc" label="FRC" color="var(--color-frc)" />
          <NavLink href="/ftc" label="FTC" color="var(--color-ftc)" />
          <NavLink href="/fll" label="FLL" color="var(--color-fll)" />
          <Link
            href="/submit"
            className="ml-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Submit
          </Link>
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
