/**
 * Stable identity for a tool's URLs, so the same project cannot be published
 * twice under two spellings.
 *
 * Two real cases got through the exact-URL and name checks (2026-09-14):
 *  - a GitHub repo was RENAMED (CoreControlQuickstart -> corecontrol-quickstart);
 *    GitHub 301-redirects the old path, but the two URL strings differ, so the
 *    exact-URL dedup and the 0.85 name-similarity gate both missed it.
 *  - the SAME Chief Delphi thread was published once for the app (frcbom.com)
 *    and once for its docs subdomain (docs.frcbom.com): different homepages,
 *    different names, so nothing tied them together.
 *
 * These reduce each URL to the identity that a rename or a subdomain cannot
 * change: owner + repo (separators stripped) for GitHub, the registrable
 * domain for a homepage. Pure, so the publish gate and its test share them.
 */

/** github.com owner/repo with case and separators removed, so a rename or a
 * hyphen/casing change collapses to one identity: 'corecontrollib/corecontrolquickstart'. */
export function githubRepoIdentity(url: string | null | undefined): string | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null
  const parts = u.pathname.replace(/^\/+/, '').split('/')
  if (parts.length < 2 || !parts[0] || !parts[1]) return null
  const owner = parts[0].toLowerCase()
  const repo = parts[1].replace(/\.git$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!repo) return null
  return `${owner}/${repo}`
}

/**
 * Hosts that serve many unrelated projects, so a shared registrable domain
 * there means nothing. A homepage on one of these is identified by its full
 * hostname + first path segment instead, and github.com is handled by the repo
 * identity, never the domain.
 */
const SHARED_WEB_HOSTS = new Set([
  'github.io', 'gitlab.io', 'github.com', 'gitlab.com', 'sourceforge.net',
  'vercel.app', 'netlify.app', 'pages.dev', 'web.app', 'firebaseapp.com',
  'herokuapp.com', 'onrender.com', 'replit.app', 'repl.co', 'glitch.me',
  'notion.site', 'notion.so', 'wixsite.com', 'weebly.com', 'wordpress.com',
  'blogspot.com', 'google.com', 'sites.google.com', 'docs.google.com',
  'streamlit.app', 'pythonanywhere.com', 'surge.sh', 'now.sh', 'cloudflare.net',
  'itch.io', 'fandom.com', 'readthedocs.io', 'readthedocs.org', 'gitbook.io',
  // CAD and file hosts: each URL is one team's model, not one project's site.
  'onshape.com', 'grabcad.com', 'a360.co', 'autodesk360.com', 'autodesk.com',
  'fusion.online.autodesk.com', 'drive.google.com',
])

/** Multi-label public suffixes we actually see, so "a.co.uk" is not read as "co.uk". */
const MULTI_TLDS = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'org.au', 'co.nz', 'org.nz', 'co.jp'])

/**
 * The registrable domain of a homepage ('docs.frcbom.com' -> 'frcbom.com'),
 * or null when the host serves many projects (see SHARED_WEB_HOSTS) so the
 * domain proves nothing. github.com always returns null: use the repo identity.
 */
export function siteIdentity(url: string | null | undefined): string | null {
  if (!url) return null
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  const labels = host.split('.')
  if (labels.length < 2) return null
  const lastTwo = labels.slice(-2).join('.')
  const registrable = MULTI_TLDS.has(lastTwo) && labels.length >= 3 ? labels.slice(-3).join('.') : lastTwo
  if (SHARED_WEB_HOSTS.has(host) || SHARED_WEB_HOSTS.has(registrable) || SHARED_WEB_HOSTS.has(lastTwo)) return null
  return registrable
}

/**
 * A documentation/help subdomain: docs.frcbom.com, wiki.x.org, help.y.io.
 * The frcbom duplicate was exactly this: a project's docs published beside its
 * app. Same-registrable-domain alone is NOT a duplicate signal (onshape.com,
 * ctr-electronics.com and other vendor/platform domains host many real,
 * distinct tools), so the domain check only ever fires for one of these.
 */
export function isDocsSubdomain(url: string | null | undefined): boolean {
  if (!url) return false
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return /^(docs?|wiki|help|support|guide|manual|kb|readthedocs)\./.test(host)
}
