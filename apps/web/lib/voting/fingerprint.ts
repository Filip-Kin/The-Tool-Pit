import { type NextRequest } from 'next/server'
import { createHash, randomUUID } from 'crypto'

export const VOTE_COOKIE_NAME = 'tp_vid'
export const VOTE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2 // 2 years

export interface VoterIdentity {
  /** Hashed fingerprint stored in the DB — never the raw cookie value. */
  fingerprint: string
  /** Raw UUID stored in the cookie. */
  cookieValue: string
  /** True when no cookie existed on the request — caller must set the cookie. */
  isNewCookie: boolean
}

/**
 * Resolves or creates a stable voter identity from the request cookie.
 *
 * If a tp_vid cookie is present its value is hashed to produce the fingerprint.
 * If absent a fresh UUID is generated — the caller is responsible for setting
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

function hashFingerprint(input: string): string {
  const secret = process.env.VOTE_COOKIE_SECRET ?? 'dev-secret'
  return createHash('sha256')
    .update(secret + ':' + input)
    .digest('hex')
    .slice(0, 48)
}
