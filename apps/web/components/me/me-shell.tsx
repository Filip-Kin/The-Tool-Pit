import Link from 'next/link'
import { SiteHeader } from '@/components/layout/site-header'
import { SiteFooter } from '@/components/layout/site-footer'

/**
 * Chrome for the /me pages.
 *
 * /me sits outside the (public) route group, so it does not inherit that
 * group's layout and has to bring the site header and footer itself. Kept as a
 * component rather than a route layout so the two /me pages stay
 * self-contained.
 */
export function MeShell({
  title,
  intro,
  active,
  children,
}: {
  title: string
  intro: string
  active: 'saved' | 'listings' | 'team' | 'profile' | 'notifications'
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="container mx-auto max-w-5xl px-4 py-10 sm:py-14">
          <header className="mb-10">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">{intro}</p>
            <nav className="mt-6 flex items-center gap-1 overflow-x-auto border-b border-border-subtle">
              <Tab href="/me" label="Saved" active={active === 'saved'} />
              <Tab href="/me/listings" label="Your listings" active={active === 'listings'} />
              <Tab href="/me/team" label="My teams" active={active === 'team'} />
              <Tab href="/me/team/profile" label="Team profile" active={active === 'profile'} />
              <Tab href="/me/notifications" label="Notifications" active={active === 'notifications'} />
            </nav>
          </header>
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'whitespace-nowrap border-b-2 border-primary px-3 pb-2 text-sm font-medium text-foreground'
          : 'whitespace-nowrap border-b-2 border-transparent px-3 pb-2 text-sm font-medium text-muted transition-colors hover:text-foreground'
      }
    >
      {label}
    </Link>
  )
}
