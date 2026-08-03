import { type NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const host = req.headers.get('host') ?? ''

  // photos.* subdomain → serve the /photos route tree with its own chrome.
  // API routes stay global (same-origin fetches from the subdomain still work),
  // and already-prefixed / internal paths are passed through untouched.
  if (host.startsWith('photos.')) {
    if (!pathname.startsWith('/api') && !pathname.startsWith('/photos') && !pathname.startsWith('/_next')) {
      const url = req.nextUrl.clone()
      url.pathname = `/photos${pathname}`
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
  // Run on everything except Next internals/static so the photos.* host rewrite
  // can catch public paths; /admin is still covered by this matcher.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
