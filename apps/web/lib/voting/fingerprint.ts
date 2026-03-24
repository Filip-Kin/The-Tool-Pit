import { type NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'tp_vid'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2 // 2 years

/**
 * Derives a stable voter fingerprint from the request's signed vote-id cookie.
 * The fingerprint is a one-way hash — we never store the raw cookie value.
 */
export function getVoterFingerprint(req: NextRequest): string {
  const cookieValue = req.cookies.get(COOKIE_NAME)?.value
  if (!cookieValue) {
    // No cookie yet — return a temporary fingerprint. The client should
    // send a Set-Cookie after the first vote; handled in the response.
    const ua = req.headers.get('user-agent') ?? ''
    const ip = req.headers.get('x-forwarded-for') ?? ''
    return hashFingerprint(`anon:${ua}:${ip}`)
  }
  return hashFingerprint(cookieValue)
}

function hashFingerprint(input: string): string {
  const secret = process.env.VOTE_COOKIE_SECRET ?? 'dev-secret'
  return createHash('sha256')
    .update(secret + ':' + input)
    .digest('hex')
    .slice(0, 48)
}

/** Returns the vote-id cookie name for client-side handling. */
export const VOTE_COOKIE_NAME = COOKIE_NAME
