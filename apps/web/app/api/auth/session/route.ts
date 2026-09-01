import { NextResponse } from 'next/server'
import type { User } from '@the-tool-pit/db'
import { verifyFirebaseIdToken } from '@/lib/auth/verify-token'
import { createSession, destroySession, getCurrentUser } from '@/lib/auth/session'

/**
 * The thin user the browser is allowed to see. githubLogin is here so the
 * link-GitHub card knows whether to offer the link or the re-check without a
 * second round trip; it is a public display name on GitHub either way, and
 * nothing on the client is trusted with it.
 */
function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    photoUrl: user.photoUrl,
    githubLogin: user.githubLogin,
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST { idToken } - exchange a Firebase ID token for our session cookie.
 * The ID token is verified against Google's keys before anything is written,
 * so the client cannot assert its own uid or email.
 */
export async function POST(req: Request) {
  let idToken: unknown
  try {
    ({ idToken } = await req.json())
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (typeof idToken !== 'string' || !idToken) {
    return NextResponse.json({ error: 'idToken required' }, { status: 400 })
  }

  const identity = await verifyFirebaseIdToken(idToken)
  if (!identity) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }

  const user = await createSession(identity)
  return NextResponse.json({ user: publicUser(user) })
}

/** GET - who am I? Used by the client to hydrate after a hard load. */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ user: null })
  return NextResponse.json({ user: publicUser(user) })
}

/** DELETE - sign out. Clears our cookie; the client also signs out of Firebase. */
export async function DELETE() {
  await destroySession()
  return NextResponse.json({ ok: true })
}
