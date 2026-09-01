import { headers } from 'next/headers'
import { Wrench, Camera, MapPin, Banknote } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

/**
 * The four verticals share one codebase and one deploy, split by host in
 * apps/web/middleware.ts. This control is the only place a visitor is told
 * that, so it appears in all three headers and in the footer.
 *
 * Every vertical styles its own chrome, so the switcher stays deliberately
 * quiet: no colour of its own, icons at all widths, labels only once there is
 * room for them.
 */

export type VerticalKey = 'tools' | 'photos' | 'fields' | 'grants'

interface Vertical {
  key: VerticalKey
  label: string
  /** Subdomain label, and in path mode the route prefix. 'tools' is the bare host. */
  slug: string | null
}

const VERTICALS: Vertical[] = [
  { key: 'tools', label: 'Tools', slug: null },
  { key: 'photos', label: 'Photos', slug: 'photos' },
  { key: 'fields', label: 'Fields', slug: 'fields' },
  { key: 'grants', label: 'Grants', slug: 'grants' },
]

/** Kept apart from VERTICALS so the footer form, which has no icons, does not carry them. */
const VERTICAL_ICONS: Record<VerticalKey, typeof Wrench> = {
  tools: Wrench,
  photos: Camera,
  fields: MapPin,
  grants: Banknote,
}

/** Leading host labels the middleware treats as a vertical rather than as part of the base domain. */
const VERTICAL_SUBDOMAINS = new Set(VERTICALS.map((v) => v.slug).filter((s): s is string => s !== null))

export interface VerticalLink {
  key: VerticalKey
  label: string
  href: string
  current: boolean
}

/**
 * Resolve one absolute (or relative, see below) link per vertical from the
 * request host. The hosts differ per vertical and the same build serves both
 * ttp.filipkin.com and frc.tools, so nothing here may be hardcoded to a domain:
 * we swap the leading subdomain label on whatever host we were asked on.
 *
 * Exported so the footer can render the same set as plain text links.
 */
export async function getVerticalLinks(current: VerticalKey): Promise<VerticalLink[]> {
  // Match the middleware, which keys off the plain Host header. Reading headers
  // costs nothing extra here: the root layout already awaits the session cookie,
  // so every page in this app is dynamic regardless.
  const h = await headers()
  const rawHost = h.get('host') ?? h.get('x-forwarded-host') ?? ''
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim()

  const { hostname, port } = splitHost(rawHost)

  // Strip the vertical label to get the base domain shared by all four hosts.
  const labels = hostname.split('.')
  const base = VERTICAL_SUBDOMAINS.has(labels[0]!.toLowerCase()) ? labels.slice(1).join('.') : hostname

  // A base with no dot (localhost, a bare machine name) or a literal IP cannot
  // grow a subdomain, so dev falls back to the path-prefixed routes instead.
  const pathMode = base === '' || !base.includes('.') || isIpLiteral(base)

  const scheme = proto ?? (pathMode ? 'http' : 'https')
  const suffix = port ? `:${port}` : ''

  return VERTICALS.map(({ key, label, slug }) => {
    const targetHost = pathMode || slug === null ? base : `${slug}.${base}`
    const targetPath = pathMode && slug !== null ? `/${slug}` : '/'
    // Emit a relative href when the target is the host we are already on. That
    // avoids sending the browser to an absolute URL that guesses the wrong
    // scheme or drops a dev port, and it keeps the link working behind any
    // proxy that rewrites the host on the way in.
    const href =
      targetHost === hostname ? targetPath : `${scheme}://${targetHost}${suffix}${targetPath}`
    return { key, label, href, current: key === current }
  })
}

/** Splits an authority into hostname and port, tolerating a bracketed IPv6 literal. */
function splitHost(raw: string): { hostname: string; port: string } {
  const authority = raw.trim().toLowerCase()
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    if (close === -1) return { hostname: authority, port: '' }
    return { hostname: authority.slice(0, close + 1), port: authority.slice(close + 2) }
  }
  const colon = authority.lastIndexOf(':')
  if (colon === -1) return { hostname: authority, port: '' }
  return { hostname: authority.slice(0, colon), port: authority.slice(colon + 1) }
}

function isIpLiteral(host: string): boolean {
  return host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

/**
 * Footer form of the same control: plain text links, no icons, no current-item
 * highlight beyond the label. The header switcher is hidden below sm because a
 * phone-width header cannot hold the wordmark, four icons and a call to action,
 * so on phones this row is the only way across the four verticals. Every
 * vertical's footer should render it.
 */
export async function VerticalFooterLinks({
  current,
  className,
}: {
  current: VerticalKey
  className?: string
}) {
  const links = await getVerticalLinks(current)

  return (
    <nav aria-label="Switch product" className={cn('flex flex-wrap items-center gap-4', className)}>
      {links.map(({ key, label, href, current: isCurrent }) => (
        <a
          key={key}
          href={href}
          aria-current={isCurrent ? 'page' : undefined}
          className={cn(
            'transition-colors hover:text-foreground',
            isCurrent && 'text-foreground',
          )}
        >
          {label}
        </a>
      ))}
    </nav>
  )
}

export async function VerticalSwitcher({
  current,
  className,
}: {
  current: VerticalKey
  className?: string
}) {
  const links = await getVerticalLinks(current)

  return (
    <nav
      aria-label="Switch product"
      className={cn(
        'flex shrink-0 items-center gap-0.5 rounded-md border border-border-subtle p-0.5',
        className,
      )}
    >
      {links.map(({ key, label, href, current: isCurrent }) => {
        const Icon = VERTICAL_ICONS[key]
        return (
          <a
            key={key}
            href={href}
            // Cross-host links are full navigations, so aria-current is the only
            // signal a screen reader gets about which product it is already in.
            aria-current={isCurrent ? 'page' : undefined}
            title={label}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium transition-colors',
              isCurrent
                ? 'bg-surface-2 text-foreground'
                : 'text-muted-2 hover:bg-surface hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {/* Below lg the header only has room for icons, but the link still
                needs a name, so the label goes off-screen rather than to
                display:none, which would hide it from a screen reader too. */}
            <span className="sr-only lg:not-sr-only">{label}</span>
          </a>
        )
      })}
    </nav>
  )
}
