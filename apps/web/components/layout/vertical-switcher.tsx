import { headers } from 'next/headers'
import { Wrench, Camera, MapPin, CircleDollarSign, Code2, CalendarDays, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

/**
 * The four verticals share one codebase and one deploy, split by host in
 * apps/web/middleware.ts. This module owns every control that crosses between
 * them.
 *
 * Where they appear:
 *   VerticalNav        the home page, under the search bar. The main way in.
 *   VerticalHomeCrumb  each vertical's header, as the way back to the home page.
 *   VerticalFooterLinks every footer, as the quiet complete set.
 *
 * The old icon-only switcher that sat in all four headers is gone. It was
 * cramped, it was hidden below 640px entirely, and on the home page it
 * competed with the search bar for the one thing a first-time visitor should
 * see. Buttons under the search bar have room for real labels.
 */

export type VerticalKey = 'tools' | 'photos' | 'fields' | 'grants' | 'code' | 'events'

interface Vertical {
  key: VerticalKey
  label: string
  /** Subdomain label, and in path mode the route prefix. 'tools' is the bare host. */
  slug: string | null
  /** One line for the home-page cards, so a first-time visitor knows what it is. */
  blurb: string
}

const VERTICALS: Vertical[] = [
  { key: 'tools', label: 'Tools', slug: null, blurb: 'Search the community directory of FRC, FTC and FLL tools' },
  { key: 'photos', label: 'Photos', slug: 'photos', blurb: 'Event photo albums, by event and team' },
  { key: 'fields', label: 'Fields', slug: 'fields', blurb: 'A map of practice fields you can visit' },
  { key: 'grants', label: 'Grants', slug: 'grants', blurb: 'Grants and funding your team can apply for' },
  // Robot code and CAD is its own vertical, not a page of the tools directory:
  // it is browsed by team and season rather than searched by what a tool does,
  // and it has its own submission route.
  { key: 'code', label: 'Robot Code / CAD', slug: 'robot-code', blurb: 'Team robot code and CAD, by team and season' },
  // Off-season events: a map of off-season competitions, with cost, capacity
  // and registration state, leading with what is coming up next.
  { key: 'events', label: 'Offseason Events', slug: 'events', blurb: 'Off-season competitions on a map, upcoming first' },
]

/** Kept apart from VERTICALS so the footer form, which has no icons, does not carry them. */
const VERTICAL_ICONS: Record<VerticalKey, typeof Wrench> = {
  tools: Wrench,
  photos: Camera,
  fields: MapPin,
  grants: CircleDollarSign,
  code: Code2,
  events: CalendarDays,
}

/** Leading host labels the middleware treats as a vertical rather than as part of the base domain. */
const VERTICAL_SUBDOMAINS = new Set(['photos', 'fields', 'grants'])

export interface VerticalLink {
  key: VerticalKey
  label: string
  href: string
  current: boolean
}

/**
 * Resolve one link per vertical from the request host.
 *
 * PATHS, NOT SUBDOMAINS. The four verticals live at /, /photos, /fields and
 * /grants on one host. That is the canonical scheme.
 *
 * It used to swap the leading subdomain label instead (photos.frc.tools and
 * so on). Those hosts still work, because middleware.ts still rewrites them
 * and the old links are out in the world, but nothing generates them any
 * more. The reason is concrete: frc.tools sits behind a Cloudflare zone we do
 * not control, and Cloudflare does not pass /.well-known/acme-challenge
 * through to our origin, so Let's Encrypt cannot validate a new hostname
 * there. Every new subdomain would need someone else to act before it could
 * serve HTTPS at all. A path needs nobody.
 *
 * When the visitor is already on a vertical subdomain, links go absolute to
 * the base host so they land on the canonical path form rather than being
 * rewritten back into the subdomain's own route tree.
 *
 * Exported so the footer and the home page nav render the same set.
 */
export async function getVerticalLinks(current: VerticalKey): Promise<VerticalLink[]> {
  // Match the middleware, which keys off the plain Host header. Reading headers
  // costs nothing extra here: the root layout already awaits the session cookie,
  // so every page in this app is dynamic regardless.
  const h = await headers()
  const rawHost = h.get('host') ?? h.get('x-forwarded-host') ?? ''
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim()

  const { hostname, port } = splitHost(rawHost)

  // Strip a legacy vertical label to get the host the paths live on.
  const labels = hostname.split('.')
  const onSubdomain = VERTICAL_SUBDOMAINS.has(labels[0]!.toLowerCase())
  const base = onSubdomain ? labels.slice(1).join('.') : hostname

  const scheme = proto ?? 'https'
  const suffix = port ? `:${port}` : ''

  return VERTICALS.map(({ key, label, slug }) => {
    const path = slug === null ? '/' : `/${slug}`
    // Relative when we are already on the host the paths live on. Absolute
    // only to climb out of a legacy vertical subdomain.
    const href = onSubdomain ? `${scheme}://${base}${suffix}${path}` : path
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

/**
 * The home page's way into the other three verticals.
 *
 * Sits under the search bar, in the gap above "Browse by Program". Labels are
 * real words at every width, because this is how most people will discover
 * that the photos, fields and grants sites exist at all. No blurbs: the four
 * names say what they are, and a sentence under each would be the same filler
 * the program cards used to carry.
 */
/**
 * The other verticals, as items for a header's mobile menu.
 *
 * Derived from VERTICALS rather than hand-listed per header. Every header used
 * to carry its own copy and they drifted badly: the events vertical was missing
 * from all four older menus, so from photos or fields there was no way to reach
 * it at all, and two menus labelled `/` as their own vertical when `/` is the
 * tools directory. A hardcoded list is a list that goes stale the next time a
 * vertical is added, which has now happened twice.
 *
 * The current vertical is left out. You are already looking at it, and its own
 * call to action sits below these in the same menu.
 */
export async function verticalNavItems(current: VerticalKey): Promise<{ href: string; label: string }[]> {
  const links = await getVerticalLinks(current)
  return links
    .filter((l) => l.key !== current)
    .map(({ href, label, key }) => ({ href, label: key === 'tools' ? 'Tools directory' : label }))
}

/**
 * The home page's prominent way into the other verticals, as cards.
 *
 * The pill row (VerticalNav) was too quiet: a veteran team member said he could
 * not find the fields and events sites at all until his fifth visit, because
 * the row read as chrome, not content. Cards with a big icon and one line of
 * what-it-is make the other verticals impossible to miss, and they replace the
 * old "Built on FRC.tools" tool strip that was doing the same job worse.
 *
 * The current vertical is left out: you are already on it.
 */
export async function VerticalCards({
  current,
  className,
}: {
  current: VerticalKey
  className?: string
}) {
  const links = await getVerticalLinks(current)

  return (
    <nav
      aria-label="Explore FRC.tools"
      className={cn('flex flex-wrap justify-center gap-3', className)}
    >
      {links
        .filter((l) => l.key !== current)
        .map(({ key, label, href }) => {
          const Icon = VERTICAL_ICONS[key]
          return (
            <a
              key={key}
              href={href}
              className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-primary hover:bg-primary/5 sm:w-56"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="font-semibold text-foreground">{label}</span>
            </a>
          )
        })}
    </nav>
  )
}

export async function VerticalNav({
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
      className={cn('flex flex-wrap items-center justify-center gap-2', className)}
    >
      {links.map(({ key, label, href, current: isCurrent }) => {
        const Icon = VERTICAL_ICONS[key]
        return (
          <a
            key={key}
            href={href}
            aria-current={isCurrent ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
              isCurrent
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border bg-surface text-muted hover:border-primary hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
          </a>
        )
      })}
    </nav>
  )
}

/**
 * The way back to the main site from inside a vertical.
 *
 * Every vertical is its own host, so a relative link cannot get you home and
 * the browser's back button is the only route once someone lands deep in one
 * from a search engine. This renders the wordmark as a real link to the tools
 * host, then the vertical's own name, reading as a breadcrumb.
 *
 * It replaces the icon-only switcher that used to occupy this slot and was
 * hidden below 640px, which left phones with no way out except the footer.
 */
export async function VerticalHomeCrumb({
  current,
  className,
}: {
  current: VerticalKey
  className?: string
}) {
  const links = await getVerticalLinks(current)
  const home = links.find((l) => l.key === 'tools')
  if (!home || current === 'tools') return null

  return (
    <a
      href={home.href}
      className={cn(
        'flex shrink-0 items-center gap-1.5 text-sm font-medium text-muted-2 transition-colors hover:text-foreground',
        className,
      )}
    >
      <ChevronLeft className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">frc.tools</span>
      <span className="sr-only sm:hidden">Back to frc.tools</span>
    </a>
  )
}
