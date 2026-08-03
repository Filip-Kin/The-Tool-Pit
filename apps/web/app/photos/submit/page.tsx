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
      <p className="mb-8 text-sm text-muted">
        Paste a link to an event photo gallery (SmugMug, Flickr, Google Photos, Pixieset, or
        anywhere else). We&apos;ll review it and add it to the event.
      </p>
      <AlbumSubmitForm />
    </div>
  )
}
