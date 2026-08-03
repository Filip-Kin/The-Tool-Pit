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
    // Strip an individual-photo suffix back to its gallery. SmugMug has two forms:
    //   new: ".../Gallery/i-XXXXX/..."
    //   old: ".../Gallery/9936059_Q79X9/1/677895428_FkvhD"
    let path = u.pathname
      .replace(/\/i-[A-Za-z0-9].*$/, '')
      .replace(/\/\d{3,}_[A-Za-z0-9].*$/, '')
    path = stripTrailingSlash(path)
    // A real gallery has at least Folder/Gallery; a single segment is a folder
    // listing or the account root, not a specific album.
    if (path.split('/').filter(Boolean).length < 2) return null
    return { canonicalUrl: `https://${u.host}${path}`, provider: 'smugmug' }
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

  // Dropbox - shared folders/galleries. Keep the path + rlkey (needed to open);
  // drop session/tracking params (e, st, dl).
  if (host === 'dropbox.com' || host === 'www.dropbox.com') {
    if (!/^\/(scl|s)\//.test(u.pathname)) return null
    const base = `https://www.dropbox.com${stripTrailingSlash(u.pathname)}`
    const rlkey = u.searchParams.get('rlkey')
    return { canonicalUrl: rlkey ? `${base}?rlkey=${rlkey}` : base, provider: 'dropbox' }
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
