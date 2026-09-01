'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { signInWithGoogle, signInWithEmail, registerWithEmail, resetPassword } from '@/lib/auth/client'
import { useSession } from './session-provider'

type Mode = 'signin' | 'register' | 'reset'

/**
 * One sign-in dialog for every vertical. Google first because almost everyone
 * in FIRST already has a school or personal Google account; email and password
 * is the fallback for anyone who does not, or who does not want to link one.
 */
export function SignInDialog({
  open,
  onOpenChange,
  reason,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional line explaining why sign-in is being asked for right now. */
  reason?: string
}) {
  const { refresh } = useSession()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function run(fn: () => Promise<void>, after?: () => void) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
      after?.()
    } catch (err) {
      // Firebase error codes are not readable, so map the ones people actually hit.
      const code = (err as { code?: string }).code ?? ''
      setError(friendlyAuthError(code, (err as Error).message))
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    await refresh()
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* z-2500 rather than the usual z-50 because this dialog can be opened
            from inside another one. The fields vertical stacks above Leaflet
            (header 500, FieldDialog 2000/2001, gallery lightbox 3000) and both
            dialogs portal to document.body, so at z-50 the sign-in panel opens
            behind the field modal: focus moves to something invisible and the
            link reads as dead. 2500 clears the field dialog and stays under
            the lightbox. */}
        <Dialog.Overlay className="fixed inset-0 z-[2500] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[2500] w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-subtle bg-background p-6 shadow-xl">
          <Dialog.Title className="text-lg font-semibold text-foreground">
            {mode === 'register' ? 'Create an account' : mode === 'reset' ? 'Reset your password' : 'Sign in'}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            {reason ?? 'One account across tools, photos, fields and grants.'}
          </Dialog.Description>

          {mode !== 'reset' && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(signInWithGoogle, finish)}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface disabled:opacity-50"
              >
                Continue with Google
              </button>
              <div className="my-4 flex items-center gap-3 text-xs text-muted">
                <span className="h-px flex-1 bg-border-subtle" />
                or
                <span className="h-px flex-1 bg-border-subtle" />
              </div>
            </>
          )}

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (mode === 'reset') {
                void run(() => resetPassword(email), () =>
                  setNotice('If that address has an account, a reset link is on its way.'),
                )
              } else if (mode === 'register') {
                void run(() => registerWithEmail(email, password), finish)
              } else {
                void run(() => signInWithEmail(email, password), finish)
              }
            }}
          >
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted"
            />
            {mode !== 'reset' && (
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted"
              />
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}
            {notice && <p className="text-sm text-muted">{notice}</p>}

            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {busy ? 'Working…' : mode === 'register' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {mode !== 'signin' && (
              <button type="button" className="hover:text-foreground" onClick={() => setMode('signin')}>
                Back to sign in
              </button>
            )}
            {mode === 'signin' && (
              <>
                <button type="button" className="hover:text-foreground" onClick={() => setMode('register')}>
                  Create an account
                </button>
                <button type="button" className="hover:text-foreground" onClick={() => setMode('reset')}>
                  Forgot password
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function friendlyAuthError(code: string, fallback: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password do not match an account.'
    case 'auth/email-already-in-use':
      return 'There is already an account with that email. Try signing in.'
    case 'auth/weak-password':
      return 'Pick a password of at least 8 characters.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in window closed before it finished.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection.'
    default:
      return fallback
  }
}
