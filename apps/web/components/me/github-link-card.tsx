'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Github, RefreshCw } from 'lucide-react'
import { useSession } from '@/components/auth/session-provider'
import { linkGithubAccount, recheckGithubRepos } from '@/lib/auth/client'
import { describeGithubGrant, type GithubGrantSummary } from '@/lib/github/summary'

/**
 * Link your GitHub account, and take ownership of what you wrote.
 *
 * Sits on /me/listings and on the submit forms, which is where somebody is
 * already thinking about a repository of theirs. It renders nothing for a
 * signed-out visitor: linking needs an account to link to, and a card offering
 * something you cannot do is worse than no card.
 *
 * After a run it says what changed, by name. "Linked" on its own leaves the
 * user to go and count, and zero has to be said out loud as zero rather than
 * left as silence that reads like a failure.
 */
export function GithubLinkCard({
  showWhenLinked = false,
}: {
  /**
   * Show the re-check button to somebody who has already linked. True on
   * /me/listings, where managing listings is the job. False on a submit form,
   * where a linked user has nothing left to do and the card is just noise.
   */
  showWhenLinked?: boolean
}) {
  const { user, loading, refresh } = useSession()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<GithubGrantSummary | null>(null)

  const linked = Boolean(user?.githubLogin)

  if (loading || !user) return null
  if (linked && !showWhenLinked && !summary) return null

  async function run(fn: () => Promise<GithubGrantSummary>) {
    setBusy(true)
    setError(null)
    try {
      const result = await fn()
      setSummary(result)
      // The session carries the linked login, and the page was rendered from
      // listing_owners rows this run may have just added.
      await refresh()
      router.refresh()
    } catch (err) {
      setError(friendlyGithubError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-6">
      <div className="flex items-start gap-3">
        <Github className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">
            {linked ? `GitHub: ${user.githubLogin}` : 'Link your GitHub account'}
          </h2>

          <p className="mt-2 max-w-2xl text-sm text-muted">
            {linked
              ? 'Re-check to pick up listings added since you linked. Nothing you already manage is touched.'
              : 'Link your GitHub account and you get any listing here that is built from your repositories, or from a repository belonging to an organisation you are in. We ask to read your profile and your organisations. Nothing else, and nothing is written to GitHub.'}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(linked ? recheckGithubRepos : linkGithubAccount)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
            >
              {linked ? <RefreshCw className="h-4 w-4" aria-hidden /> : <Github className="h-4 w-4" aria-hidden />}
              {busy ? 'Checking…' : linked ? 'Re-check my repositories' : 'Link GitHub'}
            </button>
          </div>

          {summary && <GrantResult summary={summary} />}

          {error && (
            <p role="alert" className="mt-3 text-sm text-frc">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/** What the run produced, named. Zero is stated, not implied by an empty list. */
function GrantResult({ summary }: { summary: GithubGrantSummary }) {
  return (
    <div className="mt-4 rounded-md border border-border-subtle bg-surface-2 p-4">
      <p className="text-sm text-foreground">{describeGithubGrant(summary)}</p>

      {summary.granted.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {summary.granted.map((listing) => (
            <li key={listing.entityId} className="text-sm">
              <Link href={listing.href} className="text-primary hover:underline">
                {listing.title}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {summary.disputed.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {summary.disputed.map((listing) => (
            <li key={listing.entityId} className="text-sm text-muted">
              {listing.title} · waiting for an admin
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Firebase codes people actually hit here, in words they can act on.
 *
 * account-exists-with-different-credential is the important one. It means they
 * signed up with Google and GitHub carries the same address, and Firebase's own
 * message for it names no account and offers no next step.
 */
function friendlyGithubError(err: unknown): string {
  const code = (err as { code?: string }).code ?? ''
  switch (code) {
    case 'auth/account-exists-with-different-credential':
      return 'You already have an account with that email address. Sign in the way you did before, then link GitHub from this page.'
    case 'auth/credential-already-in-use':
      return 'That GitHub account is already linked to a different account here. Sign in with that one instead.'
    case 'auth/user-mismatch':
      return 'That is a different GitHub account from the one linked here. Use the one you linked.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The GitHub window closed before it finished.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the GitHub popup. Allow popups for this site and try again.'
    case 'auth/network-request-failed':
      return 'Could not reach GitHub. Check your connection and try again.'
    default:
      return (err as Error).message || 'Linking GitHub failed. Try again.'
  }
}
