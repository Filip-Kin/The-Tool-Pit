/**
 * Authelia OIDC config for the admin "Log in with Authelia" flow. Confidential
 * client (authorization code + PKCE); admin access is granted when the resolved
 * user is in the `admins` LLDAP group.
 */
export const OIDC = {
  issuer: process.env.OIDC_ISSUER || 'https://auth.filipkin.com',
  clientId: process.env.TOOLPIT_OIDC_CLIENT_ID || 'toolpit',
  clientSecret: process.env.TOOLPIT_OIDC_CLIENT_SECRET || '',
  redirectUri: process.env.TOOLPIT_OIDC_REDIRECT_URI || 'https://ttp.filipkin.com/admin/api/auth/oidc/callback',
}

export const OIDC_ENDPOINTS = {
  authorization: `${OIDC.issuer}/api/oidc/authorization`,
  token: `${OIDC.issuer}/api/oidc/token`,
  userinfo: `${OIDC.issuer}/api/oidc/userinfo`,
}

/** LLDAP group that grants admin access. */
export const ADMIN_GROUP = 'admins'

/** Short-lived cookies carrying the PKCE verifier + CSRF state across the redirect. */
export const OIDC_STATE_COOKIE = 'oidc_state'
export const OIDC_VERIFIER_COOKIE = 'oidc_verifier'
