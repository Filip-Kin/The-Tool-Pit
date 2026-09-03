'use server'

import { revalidatePath } from 'next/cache'
import { isAdmin } from '@/lib/admin/auth'
import { getCurrentUser } from '@/lib/auth/session'
import { isListingEntityType } from '@/lib/queries/listing-ownership'
import {
  grantOwnershipAsAdmin,
  removeOwnershipAsAdmin,
  searchListingsByName,
  type ListingSearchResult,
} from '@/lib/listings/admin-ownership'
import type { ListingOwnerRole } from '@the-tool-pit/db'

/**
 * Admin per-user ownership actions.
 *
 * Every mutation gates on isAdmin() first, the same identity the rest of the
 * admin panel trusts (Authelia forward-auth group, break-glass ADMIN_SECRET
 * cookie). These write the TRUSTED listing_owners row directly, which is the
 * "an admin decides" branch the ownership model already allows; see
 * lib/listings/admin-ownership.ts.
 */

export interface AdminOwnershipResult {
  error?: string
  message?: string
}

/** Revoke a user's ownership of one listing. */
export async function adminRemoveOwnership(
  entityTypeRaw: string,
  entityId: string,
  userId: string,
): Promise<AdminOwnershipResult> {
  if (!(await isAdmin())) return { error: 'Admins only.' }
  if (!isListingEntityType(entityTypeRaw)) return { error: 'Unknown listing type.' }
  await removeOwnershipAsAdmin(entityTypeRaw, entityId, userId)
  revalidatePath(`/admin/users/${userId}`)
  return { message: 'Ownership removed.' }
}

/** Grant a user ownership of one listing at the chosen role, by admin decision. */
export async function adminAddOwnership(
  entityTypeRaw: string,
  entityId: string,
  userId: string,
  roleRaw: string,
): Promise<AdminOwnershipResult> {
  if (!(await isAdmin())) return { error: 'Admins only.' }
  if (!isListingEntityType(entityTypeRaw)) return { error: 'Unknown listing type.' }
  // Two roles only. Anything that is not 'owner' is the narrower 'editor', the
  // same coercion inviteToListing uses.
  const role: ListingOwnerRole = roleRaw === 'owner' ? 'owner' : 'editor'
  // The acting admin, for the audit stamp. A cookie/Authelia admin has no app
  // user row, so this is nullable.
  const admin = await getCurrentUser()
  await grantOwnershipAsAdmin(entityTypeRaw, entityId, userId, role, admin?.id ?? null)
  revalidatePath(`/admin/users/${userId}`)
  return { message: 'Ownership granted.' }
}

/** Name-search listings for the "add a listing" picker. Read-only. */
export async function adminSearchListings(query: string): Promise<ListingSearchResult[]> {
  if (!(await isAdmin())) return []
  return searchListingsByName(query)
}
