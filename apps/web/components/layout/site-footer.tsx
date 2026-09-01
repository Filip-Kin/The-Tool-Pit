import Link from 'next/link'
import { VerticalFooterLinks } from './vertical-switcher'
import { SiteCredit } from './site-credit'

export function SiteFooter() {
  return (
    <footer className="border-t border-border-subtle py-10">
      <div className="container mx-auto flex max-w-6xl flex-col gap-6 px-4">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground">The Tool Pit</span>
            <span className="text-xs text-muted">
              Community directory for FIRST Robotics tools
            </span>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm text-muted">
            <Link href="/frc" className="hover:text-foreground transition-colors">FRC</Link>
            <Link href="/ftc" className="hover:text-foreground transition-colors">FTC</Link>
            <Link href="/fll" className="hover:text-foreground transition-colors">FLL</Link>
            <Link href="/submit" className="hover:text-foreground transition-colors">Submit a Tool</Link>
            <Link href="/admin" className="hover:text-foreground transition-colors">Admin</Link>
          </nav>
        </div>

        {/* The four verticals, on their own line so they read as siblings of this
            site rather than as more tools-directory nav. */}
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <SiteCredit className="text-xs text-muted-2" />
          <VerticalFooterLinks current="tools" />
        </div>
      </div>
    </footer>
  )
}
