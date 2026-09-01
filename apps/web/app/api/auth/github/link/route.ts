import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { verifyFirebaseIdToken } from '@/lib/auth/verify-token'
import { createSession } from '@/lib/auth/session'
import { GithubLinkError, readGithubIdentity } from '@/lib/github/identity'
import { applyGithubGrants, linkGithubIdentity } from '@/lib/github/grant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST { idToken, accessToken } - link a GitHub account and grant what it owns.
 *
 * Why a route and not a server action: the GitHub OAuth access token exists for
 * one moment. Firebase hands it to the browser in the popup result and does not
 * keep it, so the client has to send it somewhere immediately. It arrives here,
 * gets used for two read-only GitHub calls, and is never written down. Nothing
 * in this file logs it and no error message carries it.
 *
 * The Firebase ID token beside it is what proves who is asking, verified
 * against Google's keys the same way /api/auth/session does. The access token
 * proves nothing about our user, only about a GitHub account, which is why both
 * have to be here.
 *
 * The same route serves three flows, because they are the same work:
 *   - signing in with GitHub for the first time
 *   - linking GitHub to an account that already exists
 *   - re-checking, for a user who linked before and has published since
 */
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { idToken, accessToken } = (body ?? {}) as { idToken?: unknown; accessToken?: unknown }
  if (typeof idToken !== 'string' || !idToken) {
    return NextResponse.json({ error: 'idToken required' }, { status: 400 })
  }
  if (typeof accessToken !== 'string' || !accessToken) {
    return NextResponse.json({ error: 'accessToken required' }, { status: 400 })
  }

  const identity = await verifyFirebaseIdToken(idToken)
  if (!identity) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }

  // Mint the session first. A first-time GitHub sign-in has no user row yet,
  // and doing this before the GitHub calls means a GitHub hiccup leaves the
  // person signed in with a plain "try the link again" rather than signed out.
  const user = await createSession(identity)
  if (user.blockedReason) {
    return NextResponse.json({ error: 'This account cannot make changes.' }, { status: 403 })
  }

  try {
    const github = await readGithubIdentity(accessToken)
    await linkGithubIdentity(user, github)
    const summary = await applyGithubGrants(user, github)

    revalidatePath('/me/listings')
    return NextResponse.json(summary)
  } catch (err) {
    // GithubLinkError carries wording we wrote and the user can act on.
    if (err instanceof GithubLinkError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    // Anything else is ours to fix, not theirs. The message is logged, the
    // error object is not: only strings we constructed reach a log line here.
    console.error('[github-link] grant failed:', (err as Error).message)
    return NextResponse.json({ error: 'Something went wrong linking GitHub. Try again.' }, { status: 500 })
  }
}
