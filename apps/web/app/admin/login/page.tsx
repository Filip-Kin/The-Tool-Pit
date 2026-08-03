const ERRORS: Record<string, string> = {
  denied: 'That account is not an admin.',
  state: 'Login session expired. Please try again.',
  token: 'Could not complete sign-in. Please try again.',
  userinfo: 'Could not read your account. Please try again.',
  config: 'Sign-in is not configured. Contact the site owner.',
  error: 'Something went wrong. Please try again.',
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const message = error ? (ERRORS[error] ?? ERRORS.error) : null

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex w-80 flex-col gap-4 rounded-lg border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold text-foreground">Admin</h1>
        <p className="text-sm text-muted">Sign in with your Authelia account.</p>
        {message && <p className="text-xs text-frc">{message}</p>}
        <a
          href="/admin/api/auth/oidc/login"
          className="flex h-10 items-center justify-center rounded-lg bg-primary text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          Log in with Authelia
        </a>
      </div>
    </div>
  )
}
