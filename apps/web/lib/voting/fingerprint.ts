import { type NextRequest } from 'next/server'
import { createHash, randomUUID } from 'crypto'

export const VOTE_COOKIE_NAME = 'tp_vid'
export const VOTE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2 // 2 years

export interface VoterIdentity {
  /** Hashed fingerprint stored in the DB, never the raw cookie value. */
  fingerprint: string
  /** Raw UUID stored in the cookie. */
  cookieValue: string
  /** True when no cookie existed on the request, caller must set the cookie. */
  isNewCookie: boolean
}

/**
 * Resolves or creates a stable voter identity from the request cookie.
 *
 * If a tp_vid cookie is present its value is hashed to produce the fingerprint.
 * If absent a fresh UUID is generated, the caller is responsible for setting
 * the cookie in the response so subsequent requests reuse the same fingerprint.
 */
export function resolveVoterIdentity(req: NextRequest): VoterIdentity {
  const existing = req.cookies.get(VOTE_COOKIE_NAME)?.value
  const cookieValue = existing ?? randomUUID()
  return {
    fingerprint: hashFingerprint(cookieValue),
    cookieValue,
    isNewCookie: !existing,
  }
}

export function hashFingerprint(input: string): string {
  const secret = process.env.VOTE_COOKIE_SECRET ?? 'dev-secret'
  return createHash('sha256')
    .update(secret + ':' + input)
    .digest('hex')
    .slice(0, 48)
}

/**
 * The current visitor's fingerprint during a SERVER RENDER, or null when they
 * have never voted.
 *
 * The vote route resolves identity from a NextRequest and may mint a cookie. A
 * server component cannot set one, and does not need to: with no cookie there
 * are no votes to show. Reading it here is what lets a page render the button
 * already pressed. Without this the button always rendered unpressed after a
 * reload, so a vote that had definitely been counted looked like it had not.
 */
export async function currentVoterFingerprint(): Promise<string | null> {
  const { cookies } = await import('next/headers')
  const jar = await cookies()
  const value = jar.get(VOTE_COOKIE_NAME)?.value
  return value ? hashFingerprint(value) : null
}
