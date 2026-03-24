import { cookies } from 'next/headers'
import Link from 'next/link'

const NAV_ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/tools', label: 'Tools' },
  { href: '/admin/candidates', label: 'Candidates' },
  { href: '/admin/submissions', label: 'Submissions' },
  { href: '/admin/crawls', label: 'Crawl Jobs' },
  { href: '/admin/analytics', label: 'Analytics' },
  { href: '/admin/sources', label: 'Sources' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const authed = cookieStore.get('admin_token')?.value === process.env.ADMIN_SECRET

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
