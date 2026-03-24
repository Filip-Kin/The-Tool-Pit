import Link from 'next/link'

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-border-subtle)] py-10">
      <div className="container mx-auto max-w-6xl px-4 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-[var(--color-foreground)]">The Tool Pit</span>
          <span className="text-xs text-[var(--color-muted)]">
            Community directory for FIRST Robotics tools
          </span>
        </div>
        <nav className="flex flex-wrap gap-4 text-sm text-[var(--color-muted)]">
          <Link href="/frc" className="hover:text-[var(--color-foreground)] transition-colors">FRC</Link>
          <Link href="/ftc" className="hover:text-[var(--color-foreground)] transition-colors">FTC</Link>
          <Link href="/fll" className="hover:text-[var(--color-foreground)] transition-colors">FLL</Link>
          <Link href="/submit" className="hover:text-[var(--color-foreground)] transition-colors">Submit a Tool</Link>
          <Link href="/admin" className="hover:text-[var(--color-foreground)] transition-colors">Admin</Link>
        </nav>
      </div>
    </footer>
  )
}
