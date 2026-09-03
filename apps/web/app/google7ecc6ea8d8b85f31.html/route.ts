/**
 * Google Search Console verification. We ship Next in standalone output, which
 * does NOT serve files from public/, so the uploaded google*.html 404s. Serve
 * the exact body Search Console expects from a route instead.
 */
export const dynamic = 'force-static'

export function GET() {
  return new Response('google-site-verification: google7ecc6ea8d8b85f31.html\n', {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
