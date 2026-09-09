import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { User } from '@the-tool-pit/db'
import { getCurrentUser } from '@/lib/auth/session'

/**
 * Admin access is the application's own account: users.is_admin on the row
 * behind the ttp_session cookie. Nothing is read from request headers.
 *
 * Fallback: the ADMIN_SECRET cookie, kept as break-glass for a box with no
 * admin account yet. It carries no identity, so it stamps 'admin'.
 */
function breakGlass(jar: Awaited<ReturnType<typeof cookies>>): boolean {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return false
  return jar.get('admin_token')?.value === secret
}

/** True if the current request is an authenticated admin. */
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser()
  if (user?.isAdmin) return true
  return breakGlass(await cookies())
}

/** Redirect to the login page unless the request is an authenticated admin. */
export async function assertAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect('/admin/login')
}

/** A user's name for audit stamps: display name, else email, else 'admin'. */
export function adminName(user: Pick<User, 'displayName' | 'email'> | null | undefined): string {
  return user?.displayName?.trim() || user?.email?.trim() || 'admin'
}

/** Who is acting, for verifiedBy / reviewedBy stamps. 'admin' on the break-glass cookie. */
export async function adminIdentity(): Promise<string> {
  return adminName(await getCurrentUser())
}
