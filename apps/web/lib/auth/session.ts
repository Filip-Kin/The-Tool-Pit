import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { users, type User } from '@the-tool-pit/db'
import type { FirebaseIdentity } from './verify-token'
import { claimAnonymousVotes } from '../voting/claim-votes'

/**
 * Sessions.
 *
 * A Firebase ID token lives about an hour, which is too short to hold a
 * signed-in session and too chatty to re-verify against Google on every
 * request. So: verify the ID token ONCE at sign-in, upsert our own user row,
 * then issue our own short JWT in an HttpOnly cookie carrying only our user
 * id. Nothing in the cookie is trusted beyond the signature.
 */

const COOKIE_NAME = 'ttp_session'
const SESSION_DAYS = 30

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET
  if (!raw || raw.length < 32) {
    throw new Error('SESSION_SECRET is unset or shorter than 32 characters')
  }
  return new TextEncoder().encode(raw)
}

/** Mint the session cookie for a verified identity, creating the user if new. */
export async function createSession(identity: FirebaseIdentity): Promise<User> {
  const db = getDb()

  // Upsert on firebaseUid. Profile fields are refreshed from the provider on
  // every sign-in; isAdmin is deliberately absent from the update so a
  // re-login can never re-assert or clear it.
  const [user] = await db
    .insert(users)
    .values({
      firebaseUid: identity.uid,
      email: identity.email,
      emailVerified: identity.emailVerified,
      displayName: identity.displayName,
      photoUrl: identity.photoUrl,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.firebaseUid,
      set: {
        email: identity.email,
        emailVerified: identity.emailVerified,
        displayName: identity.displayName,
        photoUrl: identity.photoUrl,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning()

  const token = await new SignJWT({ uid: user.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret())

  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })

  // The upvotes cast from this browser before signing in are this person's, so
  // they come with them. Deliberately not awaited for its result: it never
  // throws and a slow claim must not hold up a sign-in.
  await claimAnonymousVotes(user.id)

  return user
}

export async function destroySession(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}

/**
 * The signed-in user, or null. Safe to call from any server component.
 * A blocked user is returned as null everywhere: they can still sign in with
 * Firebase, they just have no account here.
 */
export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) return null

  let userId: string
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    if (typeof payload.uid !== 'string') return null
    userId = payload.uid
  } catch {
    return null
  }

  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user || user.blockedReason) return null
  return user
}

/** For write paths: the user, or throw. Never returns a blocked user. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) throw new Error('UNAUTHENTICATED')
  return user
}
