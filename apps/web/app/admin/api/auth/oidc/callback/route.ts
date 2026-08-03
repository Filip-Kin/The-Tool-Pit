import { type NextRequest, NextResponse } from 'next/server'
import {
  OIDC,
  OIDC_ENDPOINTS,
  ADMIN_GROUP,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
} from '@/lib/admin/oidc'

function fail(req: NextRequest, reason: string) {
  const url = new URL('/admin/login', req.url)
  url.searchParams.set('error', reason)
  return NextResponse.redirect(url)
}

/**
 * Authelia OIDC callback. Verifies state, exchanges the code, checks the user is
 * in the admins group, and grants an admin session. Admin access is gated on the
 * `admins` group - no password anywhere.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const cookieState = req.cookies.get(OIDC_STATE_COOKIE)?.value
  const verifier = req.cookies.get(OIDC_VERIFIER_COOKIE)?.value

  if (!code || !state || !cookieState || state !== cookieState || !verifier) {
    return fail(req, 'state')
  }
  if (!OIDC.clientSecret) {
    console.error('[oidc] TOOLPIT_OIDC_CLIENT_SECRET not set')
    return fail(req, 'config')
  }

  try {
    // 1. Exchange the authorization code for tokens (client_secret_post + PKCE).
    const tokenRes = await fetch(OIDC_ENDPOINTS.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: OIDC.redirectUri,
        client_id: OIDC.clientId,
        client_secret: OIDC.clientSecret,
        code_verifier: verifier,
      }),
    })
    if (!tokenRes.ok) {
      console.error('[oidc] token exchange failed', tokenRes.status, await tokenRes.text())
      return fail(req, 'token')
    }
    const { access_token } = (await tokenRes.json()) as { access_token?: string }
    if (!access_token) return fail(req, 'token')

    // 2. Resolve the user + groups from userinfo.
    const uiRes = await fetch(OIDC_ENDPOINTS.userinfo, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (!uiRes.ok) return fail(req, 'userinfo')
    const claims = (await uiRes.json()) as { groups?: string[] }
    const groups = (claims.groups ?? []).map((g) => g.toLowerCase())
    if (!groups.includes(ADMIN_GROUP)) return fail(req, 'denied')

    // 3. Grant the admin session (same cookie isAdmin/middleware already trust).
    const res = NextResponse.redirect(new URL('/admin', req.url))
    res.cookies.set('admin_token', process.env.ADMIN_SECRET!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    })
    res.cookies.delete(OIDC_STATE_COOKIE)
    res.cookies.delete(OIDC_VERIFIER_COOKIE)
    return res
  } catch (err) {
    console.error('[oidc] callback error', err)
    return fail(req, 'error')
  }
}
