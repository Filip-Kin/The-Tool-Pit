import type { Metadata } from 'next'
import Link from 'next/link'
import { AlbumsHeader } from '@/components/albums/albums-header'
import { VerticalFooterLinks } from '@/components/layout/vertical-switcher'

export const metadata: Metadata = {
  title: {
    default: 'FIRST Event Photos',
    template: '%s | FIRST Event Photos',
  },
  description:
    'Photo albums from FRC events. Search by event name, event code, or team number.',
}

export default async function PhotosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AlbumsHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border-subtle py-6">
        <div className="container mx-auto flex max-w-6xl flex-col gap-2 px-4 text-sm text-muted-2 sm:flex-row sm:items-center sm:justify-between">
          <span>FIRST Event Photos</span>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/submit" className="hover:text-foreground">Submit an album</Link>
            <VerticalFooterLinks current="photos" />
          </div>
        </div>
      </footer>
    </div>
  )
}
