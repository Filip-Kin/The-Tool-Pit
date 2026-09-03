import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { ListingEditForm } from '@/components/me/listing-edit-form'
import { ListingAccessPanel } from '@/components/me/listing-access-panel'
import { LeaveListingPanel } from '@/components/me/leave-listing-panel'
import { AlbumCoverPanel } from '@/components/me/album-cover-panel'
import { FieldPhotosPanel } from '@/components/me/field-photos-panel'
import { entityNoun } from '@/components/me/listing-labels'
import { albums, fieldPhotos, TOOL_TYPES } from '@the-tool-pit/db'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { LISTING_WRITE_ROLES } from '@the-tool-pit/db'
import {
  getOwnerRole,
  isListingEntityType,
  listOwnersOf,
  loadListingForEdit,
} from '@/lib/queries/listing-ownership'
import { MAX_PHOTOS } from '@/lib/fields/form-parse'
import {
  inviteToListing,
  removeFieldPhoto,
  removeOwner,
  saveAlbumCover,
  saveAlbumListing,
  saveEventListing,
  saveFieldListing,
  saveFieldPhotos,
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
  // id cannot be used to probe what exists. Both listing roles may edit; the
  // check is written against the write set so a stray legacy role is refused.
  const role = await getOwnerRole(user.id, type, id)
  if (role === null || !LISTING_WRITE_ROLES.includes(role)) redirect('/me/listings')

  const [listing, members] = await Promise.all([loadListingForEdit(type, id), listOwnersOf(type, id)])
  if (!listing) notFound()

  // Neither the album cover nor the field gallery is a form field: they are
  // files. So they are read separately, and only for the vertical that has one.
  const coverUrl = type === 'album' ? await albumCoverUrl(id) : null
  const photoIds = type === 'field' ? await fieldPhotoIds(id) : []

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

        {/* Practice fields only, and for the same reason. */}
        {type === 'field' && (
          <FieldPhotosPanel
            entityId={id}
            photos={photoIds}
            maxPhotos={MAX_PHOTOS}
            addAction={saveFieldPhotos}
            removeAction={removeFieldPhoto}
          />
        )}

        <ListingAccessPanel
          entityType={type}
          entityId={id}
          members={members}
          isOwner={role === 'owner'}
          currentUserId={user.id}
          inviteAction={inviteToListing}
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

/** The field's gallery, in the order the public page shows it. */
async function fieldPhotoIds(fieldId: string): Promise<string[]> {
  const db = getDb()
  const rows = await db
    .select({ id: fieldPhotos.id })
    .from(fieldPhotos)
    .where(eq(fieldPhotos.fieldId, fieldId))
    .orderBy(asc(fieldPhotos.sortOrder), asc(fieldPhotos.createdAt))
  return rows.map((r) => r.id)
}
