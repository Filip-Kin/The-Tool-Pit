import { type NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const host = req.headers.get('host') ?? ''

  // photos.* subdomain → serve the /photos route tree with its own chrome.
  // API routes stay global (same-origin fetches from the subdomain still work),
  // and already-prefixed / internal paths are passed through untouched.
  // /me is exempt too: the account pages are one canonical set shared by all
  // four verticals, and the user menu links to them relatively from every
  // header, so without the exemption /me would rewrite to /photos/me and 404.
  if (host.startsWith('photos.')) {
    if (
      !pathname.startsWith('/api') &&
      !pathname.startsWith('/photos') &&
      !pathname.startsWith('/me') &&
      !pathname.startsWith('/_next')
    ) {
      const url = req.nextUrl.clone()
      url.pathname = `/photos${pathname}`
      return NextResponse.rewrite(url)
    }
    return NextResponse.next()
  }

  // fields.* subdomain → serve the /fields route tree (the Practice Field Map)
  // with its own chrome. Same host-rewrite shape as photos.*.
  if (host.startsWith('fields.')) {
    if (
      !pathname.startsWith('/api') &&
      !pathname.startsWith('/fields') &&
      !pathname.startsWith('/me') &&
      !pathname.startsWith('/_next')
    ) {
      const url = req.nextUrl.clone()
      url.pathname = `/fields${pathname}`
      return NextResponse.rewrite(url)
    }
    return NextResponse.next()
  }

  // grants.* subdomain → serve the /grants route tree. Same host-rewrite shape
  // as photos.* and fields.*. Alert emails and cross-vertical cards both build
  // links as ${GRANTS_ORIGIN}/grants/<slug>, so the already-prefixed pass
  // through matters as much as the rewrite itself.
  if (host.startsWith('grants.')) {
    if (
      !pathname.startsWith('/api') &&
      !pathname.startsWith('/grants') &&
      !pathname.startsWith('/me') &&
      !pathname.startsWith('/_next')
    ) {
      const url = req.nextUrl.clone()
      url.pathname = `/grants${pathname}`
      return NextResponse.rewrite(url)
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
