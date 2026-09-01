/**
 * Where the four verticals live, as absolute origins.
 *
 * /me is served from the tools host, so anything pointing at photos, fields or
 * grants has to cross a subdomain. A bare "/fields/..." path is no good either:
 * middleware rewrites paths per host, so a relative link from the tools host
 * would land on the tools route tree. Hence absolute origins for the other
 * three and a relative path for tools.
 *
 * The env vars exist so a dev box can point these at local ports; the defaults
 * are production.
 */

export interface VerticalLink {
  key: 'tools' | 'photos' | 'fields' | 'grants'
  name: string
  /** One line, written for someone who has never used the site. */
  blurb: string
  href: string
}

export const PHOTOS_ORIGIN = process.env.NEXT_PUBLIC_PHOTOS_URL ?? 'https://photos.ttp.filipkin.com'
export const FIELDS_ORIGIN = process.env.NEXT_PUBLIC_FIELDS_URL ?? 'https://fields.ttp.filipkin.com'
export const GRANTS_ORIGIN = process.env.NEXT_PUBLIC_GRANTS_URL ?? 'https://grants.ttp.filipkin.com'

export const VERTICALS: VerticalLink[] = [
  {
    key: 'tools',
    name: 'Tools directory',
    blurb: 'Calculators, apps and resources for FRC, FTC and FLL. Save the ones your team keeps reaching for.',
    href: '/',
  },
  {
    key: 'photos',
    name: 'FIRST Event Photos',
    blurb: 'Photo albums from events, gathered in one place. Save an event to find its albums again next season.',
    href: PHOTOS_ORIGIN,
  },
  {
    key: 'fields',
    name: 'Practice Field Map',
    blurb: 'Practice fields teams are willing to share. Save the ones within driving distance of your shop.',
    href: FIELDS_ORIGIN,
  },
  {
    key: 'grants',
    name: 'Grants',
    blurb: 'Funding your team can actually apply for, with human-checked deadlines. Save one to keep an eye on it.',
    href: GRANTS_ORIGIN,
  },
]

/**
 * Turn a favourite's href into something safe to render from this host.
 *
 * getFavoritesForUser() returns whatever path the owning vertical uses. If it
 * gave us an absolute URL we use it untouched; if it gave us a path we prefix
 * the origin the entity actually lives on, because a relative path here would
 * resolve against the tools host and 404.
 */
export function resolveFavoriteHref(entityType: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href
  const path = href.startsWith('/') ? href : `/${href}`
  switch (entityType) {
    case 'album':
    case 'event':
      return `${PHOTOS_ORIGIN}${path}`
    case 'field':
      return `${FIELDS_ORIGIN}${path}`
    case 'grant':
      return `${GRANTS_ORIGIN}${path}`
    default:
      // Tools are on this host, so the path is already correct.
      return path
  }
}
