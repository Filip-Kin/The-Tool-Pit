import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { ListingEditForm } from '@/components/me/listing-edit-form'
import { ListingAccessPanel } from '@/components/me/listing-access-panel'
import { LeaveListingPanel } from '@/components/me/leave-listing-panel'
import { AlbumCoverPanel } from '@/components/me/album-cover-panel'
import { entityNoun } from '@/components/me/listing-labels'
import { albums, TOOL_TYPES } from '@the-tool-pit/db'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  getOwnerRole,
  isListingEntityType,
  listOwnersOf,
  loadListingForEdit,
} from '@/lib/queries/listing-ownership'
import {
  createInvite,
  removeOwner,
  saveAlbumCover,
  saveAlbumListing,
  saveEventListing,
  saveFieldListing,
  saveGrantListing,
  saveToolListing,
} from '../../actions'

export const metadata: Metadata = {
  title: 'Edit listing',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const SAVE_ACTIONS = {
  tool: saveToolListing,
  album: saveAlbumListing,
  field: saveFieldListing,
  event: saveEventListing,
  grant: saveGrantListing,
} as const

/**
 * Option tuples the field spec cannot hold itself.
 *
 * TOOL_TYPES comes from the db barrel, which re-exports the postgres client, so
 * the form takes it as a prop rather than importing it and pulling net and tls
 * into the browser bundle. Everything else the form needs is on a zero-
 * dependency enum subpath and is in the spec already.
 */
const DYNAMIC_OPTIONS: Record<string, readonly string[]> = { toolType: TOOL_TYPES }

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>
}) {
  const { type, id } = await params
  const user = await getCurrentUser()
  if (!user) redirect('/')
  if (!isListingEntityType(type)) notFound()

  // The gate. No edit access, no page. Same as a missing listing so a guessed
  // id cannot be used to probe what exists.
  const role = await getOwnerRole(user.id, type, id)
  if (role === null || role === 'viewer') redirect('/me/listings')

  const [listing, members] = await Promise.all([loadListingForEdit(type, id), listOwnersOf(type, id)])
  if (!listing) notFound()

  // The cover is not a form field (it is a file), so it is read separately and
  // only for the one vertical that has one.
  const coverUrl = type === 'album' ? await albumCoverUrl(id) : null

  return (
    <MeShell
      title={`Edit ${entityNoun(type).toLowerCase()}`}
      intro={listing.facts.title}
      active="listings"
    >
      <div className="flex flex-col gap-8">
        <Link href="/me/listings" className="text-sm text-muted transition-colors hover:text-foreground">
          ← Back to your listings
        </Link>

        <ListingEditForm
          entityId={id}
          listing={listing}
          dynamicOptions={DYNAMIC_OPTIONS}
          saveAction={SAVE_ACTIONS[type]}
        />

        {/* Albums only. A file upload is not an autosaving text box, so it gets
            its own panel and its own button rather than a field in the form. */}
        {type === 'album' && (
          <AlbumCoverPanel entityId={id} currentUrl={coverUrl} saveAction={saveAlbumCover} />
        )}

        <ListingAccessPanel
          entityType={type}
          entityId={id}
          members={members}
          isOwner={role === 'owner'}
          currentUserId={user.id}
          createInviteAction={createInvite}
          removeAction={removeOwner}
        />

        <p className="text-sm text-muted-2">
          <a
            href={listing.facts.href}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            View the public listing
          </a>
        </p>

        {/* Last on the page, past everything anyone came here for. It used to be
            a one-click button beside Edit on /me/listings. */}
        <LeaveListingPanel entityType={type} entityId={id} leaveAction={removeOwner} />
      </div>
    </MeShell>
  )
}

/** The album's current cover, for the upload panel's preview. Null when it has none. */
async function albumCoverUrl(albumId: string): Promise<string | null> {
  const db = getDb()
  const [row] = await db
    .select({ coverImageUrl: albums.coverImageUrl })
    .from(albums)
    .where(eq(albums.id, albumId))
    .limit(1)
  return row?.coverImageUrl ?? null
}
