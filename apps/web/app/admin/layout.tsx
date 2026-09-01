import { Suspense } from 'react'
import Link from 'next/link'
import { isAdmin } from '@/lib/admin/auth'
import { getAdminQueueCounts } from '@/lib/admin/queue-counts'
import { AdminNav } from './admin-nav'

/**
 * Grouped by vertical, because the verticals are the shape of this product.
 * The nav itself is a client component: it reads the current route to work out
 * which group you are in, and remembers which groups you left open.
 *
 * The queue counts are read HERE, once, and handed down. They are the reason
 * an admin opens a page at all, so every entry that is a queue wears its own,
 * and one grouped query for the whole sidebar is the only version of that
 * which is cheap enough to run on every admin page.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authed = await isAdmin()

  if (!authed) {
    return <>{children}</>
  }

  // After the gate, never before: the login page must not query anything.
  const counts = await getAdminQueueCounts()

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
        {/* Suspense because the nav reads the query string, which Next requires
            a boundary for on any route that can be prerendered. */}
        <Suspense fallback={null}>
          <AdminNav counts={counts} />
        </Suspense>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto bg-background">{children}</main>
    </div>
  )
}
