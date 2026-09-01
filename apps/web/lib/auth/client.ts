'use client'

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  type Auth,
  type User as FirebaseUser,
} from 'firebase/auth'
import { firebaseConfig } from './firebase-config'

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
