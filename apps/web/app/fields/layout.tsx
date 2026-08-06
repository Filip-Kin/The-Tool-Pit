import type { Metadata } from 'next'
import Link from 'next/link'
import { FieldsHeader } from '@/components/fields/fields-header'

export const metadata: Metadata = {
  title: {
    default: 'Practice Field Map',
    template: '%s | Practice Field Map',
  },
  description:
    'Find FRC practice fields near you. A community map of shared practice spaces, filterable by field type, FMS, ceiling height, and availability.',
}

export default function FieldsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <FieldsHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border-subtle py-6">
        <div className="container mx-auto flex max-w-6xl flex-col gap-2 px-4 text-sm text-muted-2 sm:flex-row sm:items-center sm:justify-between">
          <span>Practice Field Map</span>
          <div className="flex items-center gap-4">
            <Link href="/submit" className="hover:text-foreground">Add a field</Link>
            <a href="https://ttp.filipkin.com" className="hover:text-foreground">The Tool Pit</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
