import type { Metadata } from 'next'
import Link from 'next/link'
import { GrantsHeader } from '@/components/grants/grants-header'
import { VerticalFooterLinks } from '@/components/layout/vertical-switcher'

export const metadata: Metadata = {
  title: {
    default: 'Grants for FIRST teams',
    template: '%s | Grants',
  },
  description:
    'Funding a FIRST team can apply for: who funds it, how much, what it takes, and when it closes. Every deadline is checked by a person before it appears here.',
}

export default function GrantsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <GrantsHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border-subtle py-6">
        <div className="container mx-auto flex max-w-6xl flex-col gap-3 px-4 text-sm text-muted-2 sm:flex-row sm:items-center sm:justify-between">
          <span>Grants</span>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/grants/submit" className="hover:text-foreground">Submit a grant</Link>
            {/* The header switcher is hidden below sm, so on a phone this row
                is the only way across to the other three verticals. */}
            <Link href="/admin" className="hover:text-foreground">Admin</Link>
            <VerticalFooterLinks current="grants" />
          </div>
        </div>
      </footer>
    </div>
  )
}
