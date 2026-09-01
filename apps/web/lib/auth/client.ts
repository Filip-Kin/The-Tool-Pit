'use client'

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  linkWithPopup,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  type Auth,
  type User as FirebaseUser,
  type UserCredential,
} from 'firebase/auth'
import { firebaseConfig } from './firebase-config'
import type { GithubGrantSummary } from '@/lib/github/summary'

/**
 * Browser-side Firebase. Everything here runs in the client bundle; the server
 * never trusts any of it. The one job of this module is to obtain an ID token
 * and hand it to POST /api/auth/session, which verifies it properly.
 */

let app: FirebaseApp | null = null

function getFirebaseApp(): FirebaseApp {
  if (app) return app
  app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  return app
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp())
}

/** Hand a fresh ID token to the server, which sets the session cookie. */
async function exchangeForSession(user: FirebaseUser): Promise<void> {
  const idToken = await user.getIdToken(/* forceRefresh */ true)
  const res = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? 'sign-in failed')
  }
}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider()
  const cred = await signInWithPopup(getFirebaseAuth(), provider)
  await exchangeForSession(cred.user)
}

// #region GitHub
//
// Linking a GitHub account is how somebody gets ownership of every listing
// built from a repository in one of their namespaces.
//
// The scopes are read:user and read:org and nothing else. `repo` would read to
// the user as full control of their repositories, and people decline that, so
// the feature would not reach the people it is for. read:org is the one that
// earns its place: most FRC teams keep org membership private, and without it
// GitHub would only tell us about public members.
//
// The access token is the awkward part. Firebase surfaces it exactly once, in
// the popup result, and never again. So it is read here, posted straight to the
// server, and dropped. It is never put in state, in storage, or in a URL.

function githubProvider(): GithubAuthProvider {
  const provider = new GithubAuthProvider()
  provider.addScope('read:user')
  provider.addScope('read:org')
  return provider
}

/** Take the one-shot access token off a popup result and hand it to the server. */
async function exchangeGithubCredential(result: UserCredential): Promise<GithubGrantSummary> {
  const accessToken = GithubAuthProvider.credentialFromResult(result)?.accessToken
  if (!accessToken) {
    throw new Error('GitHub did not return an access token. Try the link again.')
  }
  const idToken = await result.user.getIdToken(/* forceRefresh */ true)

  const res = await fetch('/api/auth/github/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken, accessToken }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? 'Linking GitHub failed.')
  return body as GithubGrantSummary
}

/**
 * Sign in with GitHub. The route mints our session cookie before it talks to
 * GitHub, so a failure here still leaves the person signed in.
 */
export async function signInWithGithub(): Promise<GithubGrantSummary> {
  const result = await signInWithPopup(getFirebaseAuth(), githubProvider())
  return exchangeGithubCredential(result)
}

/**
 * Link GitHub to the account already signed in.
 *
 * linkWithPopup rather than a second sign-in: signing in again would swap the
 * Firebase user out from under a session that is already good, and the point is
 * to add a provider to the account that exists, not to start another one.
 *
 * A provider that is already linked throws instead of returning a credential,
 * which is also the re-check case, so it falls through to the same
 * reauthenticate path.
 */
export async function linkGithubAccount(): Promise<GithubGrantSummary> {
  const auth = getFirebaseAuth()
  const user = auth.currentUser
  if (!user) throw new Error('Sign in first, then link GitHub.')

  try {
    return await exchangeGithubCredential(await linkWithPopup(user, githubProvider()))
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/provider-already-linked') {
      return recheckGithubRepos()
    }
    throw err
  }
}

/**
 * Re-run the match for somebody who linked already.
 *
 * It needs a popup, and there is no way around that: the access token is not
 * ours to keep, so the only way to ask GitHub which namespaces somebody belongs
 * to today is to have them hand us a fresh token. reauthenticate is the call
 * for a provider that is already linked; link would refuse it.
 */
export async function recheckGithubRepos(): Promise<GithubGrantSummary> {
  const auth = getFirebaseAuth()
  const user = auth.currentUser
  if (!user) throw new Error('Sign in first, then re-check your repositories.')
  return exchangeGithubCredential(await reauthenticateWithPopup(user, githubProvider()))
}

// #endregion

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email, password)
  await exchangeForSession(cred.user)
}

export async function registerWithEmail(email: string, password: string): Promise<void> {
  const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password)
  await exchangeForSession(cred.user)
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(getFirebaseAuth(), email)
}

/** Sign out of both Firebase and our own session. */
export async function signOut(): Promise<void> {
  await Promise.allSettled([
    firebaseSignOut(getFirebaseAuth()),
    fetch('/api/auth/session', { method: 'DELETE' }),
  ])
}
