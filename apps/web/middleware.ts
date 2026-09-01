import { type NextRequest, NextResponse } from 'next/server'

/** Host labels that used to be a vertical of their own. Order does not matter. */
const VERTICAL_HOSTS = ['photos', 'fields', 'grants'] as const

/**
 * Whole hosts that used to serve this app and now belong to frc.tools.
 *
 * Kept alive and redirected rather than switched off, because they are in
 * bookmarks, in Chief Delphi posts and in the Coolify domain list. The path is
 * preserved, so ttp.filipkin.com/grants lands on frc.tools/grants rather than
 * dumping everyone on the home page.
 */
const LEGACY_APP_HOSTS = ['ttp.filipkin.com'] as const

/**
 * The one host the verticals are served from.
 *
 * Derived from NEXT_PUBLIC_URL so a dev box and prod agree, and NOT by
 * stripping the leading label off the request host: fields.filipkin.com would
 * strip to filipkin.com, which is a different site entirely.
 */
function canonicalHost(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_URL
  if (configured) {
    try {
      return new URL(configured).host
    } catch {
      // Fall through to the request host rather than redirecting to a
      // malformed origin.
    }
  }
  const host = req.headers.get('host') ?? ''
  const labels = host.split('.')
  return (VERTICAL_HOSTS as readonly string[]).includes(labels[0]?.toLowerCase() ?? '')
    ? labels.slice(1).join('.')
    : host
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const host = req.headers.get('host') ?? ''

  // A whole legacy host redirects to the canonical one, path intact.
  if ((LEGACY_APP_HOSTS as readonly string[]).includes(host.toLowerCase())) {
    const target = canonicalHost(req)
    // Never redirect a host onto itself: if NEXT_PUBLIC_URL is ever set back to
    // one of these, this would otherwise be an infinite loop.
    // Same carve-out the vertical rule makes: /api keeps serving on the old
    // host so a page loaded before this shipped does not fail mid-submit.
    if (
      target &&
      target.toLowerCase() !== host.toLowerCase() &&
      !pathname.startsWith('/api') &&
      !pathname.startsWith('/_next')
    ) {
      const url = new URL(req.nextUrl)
      url.host = target
      url.port = ''
      url.protocol = 'https:'
      return NextResponse.redirect(url, 308)
    }
  }

  // Legacy vertical subdomains redirect to the canonical path form.
  //
  // The four verticals now live at /, /photos, /fields and /grants on ONE
  // host. They used to be photos.*, fields.* and grants.* and those hosts stay
  // alive, because the links are out in the world, but they send you to the
  // path now instead of serving a second copy of the site.
  //
  // The reason is not tidiness, it is TLS. frc.tools sits behind a Cloudflare
  // zone we do not control. Cloudflare passes /.well-known/acme-challenge
  // through to our origin for some hostnames in that zone and not others
  // (photos.frc.tools reaches Traefik, grants.frc.tools does not), so
  // Let's Encrypt cannot reliably validate a NEW subdomain and Cloudflare
  // refuses to serve one whose origin has no certificate. Every new vertical
  // would be blocked on somebody else's DNS console. A path is blocked on
  // nothing.
  //
  // 308, not 302: it is permanent and it must not turn a POST into a GET.
  const verticalHost = VERTICAL_HOSTS.find((v) => host.startsWith(`${v}.`))
  if (verticalHost) {
    // /api is left serving on the old host so an in-flight same-origin fetch
    // from a page loaded before this shipped does not fail mid-submit.
    if (!pathname.startsWith('/api') && !pathname.startsWith('/_next')) {
      const target = new URL(req.nextUrl)
      target.host = canonicalHost(req)
      target.port = ''
      target.protocol = 'https:'
      // /me is shared chrome and already lives at the same path on the
      // canonical host, so it moves across without gaining a prefix.
      target.pathname = pathname.startsWith('/me') || pathname.startsWith(`/${verticalHost}`)
        ? pathname
        : `/${verticalHost}${pathname === '/' ? '' : pathname}`
      return NextResponse.redirect(target, 308)
    }
    return NextResponse.next()
  }

  // Protect all /admin routes except the login page and auth API.
  // Primary auth is Authelia forward-auth (Remote-Groups header, set by Traefik).
  // The ADMIN_SECRET cookie stays as a break-glass fallback.
  if (
    pathname.startsWith('/admin') &&
    pathname !== '/admin/login' &&
    !pathname.startsWith('/admin/api/auth')
  ) {
    const groups = (req.headers.get('remote-groups') ?? '')
      .split(',')
      .map((g) => g.trim().toLowerCase())
    const isAutheliaAdmin = groups.includes('admins')
    const token = req.cookies.get('admin_token')?.value
    if (!isAutheliaAdmin && token !== process.env.ADMIN_SECRET) {
      return NextResponse.redirect(new URL('/admin/login', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  // Run on everything except Next internals/static so the vertical host
  // rewrites can catch public paths; /admin is still covered by this matcher.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
