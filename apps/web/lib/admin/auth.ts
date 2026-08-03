import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

/** LLDAP group that grants admin access (matched from Authelia's Remote-Groups). */
const ADMIN_GROUP = 'admins'

/**
 * True if the current request is an authenticated admin.
 * Primary path: Authelia forward-auth on /admin sets the Remote-Groups header
 * (Traefik overwrites any client-supplied value, so it is trustworthy here).
 * Fallback: the legacy ADMIN_SECRET cookie, kept as break-glass.
 */
export async function isAdmin(): Promise<boolean> {
  const h = await headers()
  const groups = (h.get('remote-groups') ?? '')
    .split(',')
    .map((g) => g.trim().toLowerCase())
  if (groups.includes(ADMIN_GROUP)) return true

  const c = await cookies()
  return c.get('admin_token')?.value === process.env.ADMIN_SECRET
}

/** Redirect to the login page unless the request is an authenticated admin. */
export async function assertAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect('/admin/login')
}
