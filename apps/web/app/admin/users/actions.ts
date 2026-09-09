'use server'

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { users } from '@the-tool-pit/db'
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
 * admin panel trusts (users.is_admin on the signed-in account, break-glass
 * ADMIN_SECRET cookie). These write the TRUSTED listing_owners row directly, which is the
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
  // The acting admin, for the audit stamp. A break-glass cookie admin has no
  // app user row, so this is nullable.
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

/**
 * Grant or revoke the admin flag on one account.
 *
 * The last admin cannot be removed: with no admin row left, /admin is only
 * reachable through the break-glass cookie, and that is not a state to arrive
 * at by one click. Removing yourself is allowed as long as another admin
 * remains; the page you are on will then turn you away, which is correct.
 */
export async function setUserAdmin(userId: string, makeAdmin: boolean): Promise<AdminOwnershipResult> {
  if (!(await isAdmin())) return { error: 'Admins only.' }
  const db = getDb()
  const [target] = await db
    .select({ id: users.id, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!target) return { error: 'User not found.' }
  if (target.isAdmin === makeAdmin) {
    return { message: makeAdmin ? 'Already an admin.' : 'Not an admin.' }
  }
  if (!makeAdmin) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.isAdmin, true))
    if (count <= 1) return { error: 'This is the last admin. Make somebody else an admin first.' }
  }
  await db.update(users).set({ isAdmin: makeAdmin, updatedAt: new Date() }).where(eq(users.id, userId))
  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  return { message: makeAdmin ? 'Now an admin.' : 'Admin removed.' }
}
