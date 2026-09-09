import { redirect } from 'next/navigation'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/auth/user-menu'
import { getCurrentUser } from '@/lib/auth/session'
import { isAdmin } from '@/lib/admin/auth'
import { AdminSignIn } from './admin-sign-in'

export const dynamic = 'force-dynamic'

/**
 * Admin login is the site's own account. A signed-in admin is sent straight to
 * the dashboard; a signed-in non-admin is told so and gets the account menu so
 * they can sign out and switch; a visitor gets the sign-in dialog.
 */
export default async function AdminLoginPage() {
  if (await isAdmin()) redirect('/admin')
  const user = await getCurrentUser()

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex w-80 flex-col gap-4 rounded-lg border border-border bg-surface p-6">
        {/* The sidebar carries the theme toggle, and the sidebar does not exist
            until you are signed in. This screen is the one an admin lands on
            from a bookmark, so it gets its own. */}
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-lg font-semibold text-foreground">Admin</h1>
          <ThemeToggle />
        </div>
        <p className="text-sm text-muted">Admins only.</p>
        {user ? (
          <>
            <p className="text-xs text-frc">This account is not an admin.</p>
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="truncate">{user.email ?? user.displayName ?? 'Signed in'}</span>
              <UserMenu />
            </div>
          </>
        ) : (
          <AdminSignIn />
        )}
      </div>
    </div>
  )
}
