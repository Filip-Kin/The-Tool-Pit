import { NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { OIDC, OIDC_ENDPOINTS, OIDC_STATE_COOKIE, OIDC_VERIFIER_COOKIE } from '@/lib/admin/oidc'

/** Kick off the Authelia OIDC authorization-code + PKCE flow. */
export async function GET() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')

  const url = new URL(OIDC_ENDPOINTS.authorization)
  url.searchParams.set('client_id', OIDC.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid profile email groups')
  url.searchParams.set('redirect_uri', OIDC.redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  const res = NextResponse.redirect(url)
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600,
    path: '/admin',
  }
  res.cookies.set(OIDC_STATE_COOKIE, state, opts)
  res.cookies.set(OIDC_VERIFIER_COOKIE, verifier, opts)
  return res
}
