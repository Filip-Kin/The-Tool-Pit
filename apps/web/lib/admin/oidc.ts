/**
 * Authelia OIDC config for the admin "Log in with Authelia" flow. Confidential
 * client (authorization code + PKCE); admin access is granted when the resolved
 * user is in one of ADMIN_GROUPS (`admins` or the frc.tools-only
 * `toolpit-admins`).
 */
export const OIDC = {
  issuer: process.env.OIDC_ISSUER || 'https://auth.filipkin.com',
  clientId: process.env.TOOLPIT_OIDC_CLIENT_ID || 'toolpit',
  clientSecret: process.env.TOOLPIT_OIDC_CLIENT_SECRET || '',
  redirectUri: process.env.TOOLPIT_OIDC_REDIRECT_URI || 'https://frc.tools/admin/api/auth/oidc/callback',
}

export const OIDC_ENDPOINTS = {
  authorization: `${OIDC.issuer}/api/oidc/authorization`,
  token: `${OIDC.issuer}/api/oidc/token`,
  userinfo: `${OIDC.issuer}/api/oidc/userinfo`,
}

/**
 * LLDAP groups that grant frc.tools admin access, lowercased to match the
 * callback (which lowercases the userinfo `groups` claim). `admins` is the full
 * homelab admin group; `toolpit-admins` grants the frc.tools admin panel and
 * nothing else. Kept in sync with the Authelia `toolpit_policy`.
 */
export const ADMIN_GROUPS = ['admins', 'toolpit-admins']

/**
 * Build a public URL for a redirect. Behind Coolify/Traefik, request.url reports
 * the internal container address (http://0.0.0.0:3000), so redirects must be
 * based on the public origin - derived from the (public) OIDC redirect URI.
 */
export function publicUrl(path: string): URL {
  return new URL(path, OIDC.redirectUri)
}

/** Short-lived cookies carrying the PKCE verifier + CSRF state across the redirect. */
export const OIDC_STATE_COOKIE = 'oidc_state'
export const OIDC_VERIFIER_COOKIE = 'oidc_verifier'
