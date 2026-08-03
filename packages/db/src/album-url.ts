/**
 * Album-host recognition + canonicalization. Lives in the db package so both
 * the web app (manual submissions) and the worker (connectors) share one
 * implementation and dedup on identical canonical URLs.
 */
import type { AlbumProvider } from './schema/albums'

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

/**
 * Returns a canonical album URL + provider, or null if the URL is not a
 * recognized album host.
 *
 * @param opts.allowUnknown when true, URLs on unrecognized hosts are still
 *   accepted with provider 'other' (used by trusted sources like FiM and manual
 *   submissions). Default false (used by CD to filter arbitrary forum links).
 */
export function canonicalizeAlbumUrl(
  raw: string,
  opts: { allowUnknown?: boolean } = {},
): { canonicalUrl: string; provider: AlbumProvider } | null {
  let u: URL
  try {
    u = new URL(raw.trim().replace(/[).,;:!?]+$/, '')) // strip trailing punctuation
  } catch {
    return null
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null

  const host = u.hostname.toLowerCase()
  const pathOnly = `${u.protocol}//${u.host}${stripTrailingSlash(u.pathname)}`

  // SmugMug - any subdomain (photographers get their own), keep the gallery path
  if (host === 'smugmug.com' || host.endsWith('.smugmug.com')) {
    // photos.smugmug.com is the media CDN (direct photo/video files), not a gallery
    if (host === 'photos.smugmug.com') return null
    // An individual photo is ".../Gallery/i-XXXXX..." - strip back to the gallery
    let path = u.pathname
    const iIdx = path.search(/\/i-[A-Za-z0-9]/)
    if (iIdx >= 0) path = path.slice(0, iIdx)
    path = stripTrailingSlash(path)
    if (!path) return null // bare host root is a homepage, not an album
    return { canonicalUrl: `${u.protocol}//${u.host}${path}`, provider: 'smugmug' }
  }

  // Flickr - must be an album/set of a user
  if (host === 'flickr.com' || host === 'www.flickr.com') {
    if (!/^\/photos\/[^/]+\/(albums|sets)\/\d+/.test(u.pathname)) return null
    return { canonicalUrl: stripTrailingSlash(`https://www.flickr.com${u.pathname}`), provider: 'flickr' }
  }

  // Google Photos - shared albums. Some links require a ?key= param, so keep it.
  if (host === 'photos.app.goo.gl') {
    return { canonicalUrl: stripTrailingSlash(`https://photos.app.goo.gl${u.pathname}`), provider: 'google_photos' }
  }
  if (host === 'photos.google.com') {
    if (!u.pathname.startsWith('/share/')) return null
    const base = `https://photos.google.com${stripTrailingSlash(u.pathname)}`
    const key = u.searchParams.get('key')
    return { canonicalUrl: key ? `${base}?key=${key}` : base, provider: 'google_photos' }
  }

  // Pixieset - any subdomain, keep the gallery path
  if (host === 'pixieset.com' || host.endsWith('.pixieset.com')) {
    return { canonicalUrl: pathOnly, provider: 'pixieset' }
  }

  // Google Drive - shared folders of photos
  if (host === 'drive.google.com') {
    const m = u.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/)
    if (m) return { canonicalUrl: `https://drive.google.com/drive/folders/${m[1]}`, provider: 'google_drive' }
    return null
  }

  if (opts.allowUnknown) {
    return { canonicalUrl: pathOnly, provider: 'other' }
  }

  return null
}

/** Provider for a URL, or null if not a recognized album host. */
export function detectAlbumProvider(url: string): AlbumProvider | null {
  return canonicalizeAlbumUrl(url)?.provider ?? null
}
