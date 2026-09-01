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
  { href: '/admin/practice-fields', label: 'Practice Fields' },
  { href: '/admin/field-edits', label: 'Field Edits' },
  { href: '/admin/grants', label: 'Grants' },
  { href: '/admin/grants/candidates', label: 'Grant Candidates' },
  { href: '/admin/grants/changes', label: 'Grant Changes' },
  { href: '/admin/grants/sources', label: 'Grant Sources' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authed = await isAdmin()

  if (!authed) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Sidebar on desktop; a sticky top bar with a horizontally-scrolling nav on mobile. */}
      <aside className="shrink-0 border-b border-border-subtle bg-surface md:w-56 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:py-4">
          <Link href="/" className="text-xs text-muted hover:text-foreground">
            ← The Tool Pit
          </Link>
          <p className="text-sm font-semibold text-foreground md:mt-1">Admin</p>
        </div>
        <nav className="flex gap-0.5 overflow-x-auto border-t border-border-subtle p-2 md:flex-1 md:flex-col md:overflow-visible md:border-t-0">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto bg-background">
        {children}
      </main>
    </div>
  )
}
