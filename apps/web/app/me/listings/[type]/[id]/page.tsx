import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/session'
import { MeShell } from '@/components/me/me-shell'
import { ListingEditForm } from '@/components/me/listing-edit-form'
import { ListingAccessPanel } from '@/components/me/listing-access-panel'
import { entityNoun } from '@/components/me/listing-labels'
import { TOOL_TYPES } from '@the-tool-pit/db'
import {
  getOwnerRole,
  isListingEntityType,
  listOwnersOf,
  loadListingForEdit,
} from '@/lib/queries/listing-ownership'
import {
  createInvite,
  removeOwner,
  saveAlbumListing,
  saveFieldListing,
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
} as const

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
          toolTypeOptions={TOOL_TYPES}
          saveAction={SAVE_ACTIONS[type]}
        />

        <ListingAccessPanel
          entityType={type}
          entityId={id}
          members={members}
          isOwner={role === 'owner'}
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
      </div>
    </MeShell>
  )
}
