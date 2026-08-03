import type { Metadata } from 'next'
import { AlbumSubmitForm } from '@/components/albums/album-submit-form'

export const metadata: Metadata = {
  title: 'Submit an album',
  description: 'Submit a link to an FRC event photo album for review.',
}

export default function SubmitAlbumPage() {
  return (
    <div className="container mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">Submit a photo album</h1>
      <p className="mb-6 text-sm text-muted">
        Know an FRC or FTC event album that isn&apos;t here yet? Paste the link and we&apos;ll add it.
        Works with SmugMug, Flickr, Google Photos, Google Drive, Dropbox, Pixieset, and most other hosts.
      </p>
      <ol className="mb-8 flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface p-4 text-xs text-muted">
        <li><span className="font-medium text-foreground">1.</span> Paste the album&apos;s share link (the gallery, not a single photo).</li>
        <li><span className="font-medium text-foreground">2.</span> Tell us the event and its year so it lands on the right page.</li>
        <li><span className="font-medium text-foreground">3.</span> We review every submission before it goes live.</li>
      </ol>
      <AlbumSubmitForm />
    </div>
  )
}
