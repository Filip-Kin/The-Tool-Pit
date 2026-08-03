import Link from 'next/link'
import { isAdmin } from '@/lib/admin/auth'

const NAV_ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/tools', label: 'Tools' },
  { href: '/admin/candidates', label: 'Candidates' },
  { href: '/admin/submissions', label: 'Submissions' },
  { href: '/admin/crawls', label: 'Crawl Jobs' },
  { href: '/admin/maintenance', label: 'Maintenance' },
  { href: '/admin/analytics', label: 'Analytics' },
  { href: '/admin/sources', label: 'Sources' },
  { href: '/admin/album-candidates', label: 'Album Candidates' },
  { href: '/admin/album-submissions', label: 'Album Submissions' },
  { href: '/admin/album-sources', label: 'Album Sources' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authed = await isAdmin()

  if (!authed) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border-subtle bg-surface">
        <div className="border-b border-border-subtle px-4 py-4">
          <Link href="/" className="text-xs text-muted hover:text-foreground">
            ← The Tool Pit
          </Link>
          <p className="mt-1 text-sm font-semibold text-foreground">Admin</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto bg-background">
        {children}
      </main>
    </div>
  )
}
