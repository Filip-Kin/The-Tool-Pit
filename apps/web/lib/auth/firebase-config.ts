/**
 * Firebase web app config for the `the-tool-pit` project.
 *
 * These values are public by design - the Firebase web API key identifies the
 * project, it does not authorise anything. Access control is the ID-token
 * check in ./verify-token.ts plus the authorised-domain list on the project.
 * They still come from env so a fork or a preview deploy can point elsewhere.
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
}

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)
