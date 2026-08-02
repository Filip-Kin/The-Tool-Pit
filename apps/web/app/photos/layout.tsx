import type { Metadata } from 'next'
import Link from 'next/link'
import { AlbumsHeader } from '@/components/albums/albums-header'

export const metadata: Metadata = {
  title: {
    default: 'The Photo Pit — FRC Event Photo Albums',
    template: '%s | The Photo Pit',
  },
  description:
    'Find photo albums from FRC events. Search by event name, event code, or team number to browse galleries from the community and event photographers.',
}

export default function PhotosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AlbumsHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border-subtle py-6">
        <div className="container mx-auto flex max-w-6xl flex-col gap-2 px-4 text-sm text-muted-2 sm:flex-row sm:items-center sm:justify-between">
          <span>The Photo Pit — FRC event photo albums</span>
          <div className="flex items-center gap-4">
            <Link href="/submit" className="hover:text-foreground">Submit an album</Link>
            <a href="https://thetoolpit.com" className="hover:text-foreground">The Tool Pit</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
