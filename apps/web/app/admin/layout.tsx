import Link from 'next/link'
import { isAdmin } from '@/lib/admin/auth'

/**
 * Grouped by what you are moderating, not by when the page happened to be
 * built.
 *
 * Nineteen flat links had "Candidates", "Album Candidates" and "Grant
 * Candidates" scattered down one column, so finding a queue meant reading the
 * whole list. The verticals are the shape of this product, so the sidebar uses
 * them, and the review queues sit at the top of each group because that is what
 * an admin opens the dashboard to do.
 */
const NAV_GROUPS: { label: string | null; items: { href: string; label: string }[] }[] = [
  {
    label: null,
    items: [{ href: '/admin', label: 'Overview' }],
  },
  {
    label: 'Tools',
    items: [
      { href: '/admin/submissions', label: 'Submissions' },
      { href: '/admin/candidates', label: 'Candidates' },
      { href: '/admin/tools', label: 'All tools' },
      { href: '/admin/sources', label: 'Sources' },
    ],
  },
  {
    label: 'Photos',
    items: [
      { href: '/admin/album-submissions', label: 'Submissions' },
      { href: '/admin/album-candidates', label: 'Candidates' },
      { href: '/admin/album-sources', label: 'Sources' },
    ],
  },
  {
    label: 'Fields',
    items: [
      { href: '/admin/practice-fields', label: 'Practice fields' },
      { href: '/admin/field-edits', label: 'Suggested edits' },
    ],
  },
  {
    label: 'Offseason Events',
    items: [{ href: '/admin/event-listings', label: 'Event listings' }],
  },
  {
    label: 'Grants',
    items: [
      { href: '/admin/grants/candidates', label: 'Candidates' },
      { href: '/admin/grants/changes', label: 'Changes' },
      { href: '/admin/grants', label: 'All grants' },
      { href: '/admin/grants/sources', label: 'Sources' },
    ],
  },
  {
    label: 'Accounts',
    items: [{ href: '/admin/claims', label: 'Listing claims' }],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/crawls', label: 'Crawl jobs' },
      { href: '/admin/analytics', label: 'Analytics' },
      { href: '/admin/maintenance', label: 'Maintenance' },
    ],
  },
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
        {/* One scrolling row on mobile, where group headings would cost more
            width than they earn, and a grouped column on desktop. */}
        <nav className="flex gap-0.5 overflow-x-auto border-t border-border-subtle p-2 md:flex-1 md:flex-col md:gap-0 md:overflow-visible md:border-t-0">
          {NAV_GROUPS.map((group) => (
            <div key={group.label ?? 'root'} className="contents md:mt-3 md:block md:first:mt-0">
              {group.label && (
                <p className="hidden px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2 md:block">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto bg-background">
        {children}
      </main>
    </div>
  )
}
