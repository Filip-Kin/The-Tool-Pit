import type { Metadata } from 'next'
import Link from 'next/link'
import { EventsHeader } from '@/components/events/events-header'
import { VerticalFooterLinks } from '@/components/layout/vertical-switcher'

export const metadata: Metadata = {
  title: {
    default: 'Off-season FRC events',
    template: '%s | Off-Season Events',
  },
  description:
    'Off-season FRC events on a map: when they run, what they cost, how many slots are left, and whether registration is open. Upcoming events first.',
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <EventsHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border-subtle py-6">
        <div className="container mx-auto flex max-w-6xl flex-col gap-3 px-4 text-sm text-muted-2 sm:flex-row sm:items-center sm:justify-between">
          <span>Off-Season Events</span>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/events/submit" className="hover:text-foreground">Add an event</Link>
            {/* The header switcher is hidden below sm, so on a phone this row
                is the only way across to the other verticals. */}
            <Link href="/admin" className="hover:text-foreground">Admin</Link>
            <VerticalFooterLinks current="events" />
          </div>
        </div>
      </footer>
    </div>
  )
}
