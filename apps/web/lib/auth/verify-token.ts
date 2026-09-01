import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * Verify a Firebase Auth ID token without the Admin SDK.
 *
 * Firebase signs ID tokens RS256 with a rotating Google key, published as a
 * JWK set at the URL below. `jose` caches and refreshes the set for us, so
 * this is a network call only when the signing key rotates.
 *
 * Checked, in order: signature, issuer, audience, expiry (jose does the last
 * three), then `sub` is non-empty. A token that fails any of these is not a
 * user - it is a request pretending to be one, so we return null and the
 * caller treats it as signed out.
 */
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
)

export interface FirebaseIdentity {
  uid: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
  photoUrl: string | null
  /** google.com | password | … - which provider actually signed them in. */
  signInProvider: string | null
}

export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseIdentity | null> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  if (!projectId) {
    console.error('[auth] NEXT_PUBLIC_FIREBASE_PROJECT_ID is unset; refusing to verify tokens')
    return null
  }

  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    })

    // `sub` is the Firebase uid. Firebase also sets user_id to the same value;
    // sub is the one the spec guarantees.
    const uid = typeof payload.sub === 'string' ? payload.sub : ''
    if (!uid) return null

    const firebase = payload.firebase as { sign_in_provider?: string } | undefined

    return {
      uid,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.email_verified === true,
      displayName: typeof payload.name === 'string' ? payload.name : null,
      photoUrl: typeof payload.picture === 'string' ? payload.picture : null,
      signInProvider: firebase?.sign_in_provider ?? null,
    }
  } catch (err) {
    // Expired or forged - both are "not signed in", neither is a server error.
    console.warn('[auth] ID token rejected:', (err as Error).message)
    return null
  }
}
