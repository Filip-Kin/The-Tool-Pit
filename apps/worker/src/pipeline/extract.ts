/**
 * HTML metadata extraction.
 * Deterministic first — no AI at this stage.
 */
import { parse, type HTMLElement } from 'node-html-parser'
import { mainContentRoot } from '../grants/strip.js'
import { politeFetch } from '../connectors/base.js'
import { parseGitHubUrl, fetchGitHubRepo } from '../connectors/github.js'
import type { RawCandidateMetadata } from '@the-tool-pit/db'

/**
 * Special-case GitHub repo URLs: use the GitHub API instead of HTML scraping.
 * GitHub HTML gives us their nav/marketing chrome, not the repo data.
 * We also synthesise a plain-text `rawHtml` block from the API fields so the
 * classifier has rich context without needing to call Playwright.
 */
async function extractGitHubMetadata(url: string): Promise<RawCandidateMetadata> {
  const repoInfo = await fetchGitHubRepo(url)
  if (!repoInfo) return { githubUrl: url }

  const repoName = repoInfo.fullName.split('/')[1] ?? repoInfo.fullName

  // Build a plain-text summary that the classifier reads as `rawHtml`
  const lines: string[] = [
    `Repository: ${repoInfo.fullName}`,
    `Name: ${repoName.replace(/[-_]/g, ' ')}`,
  ]
  if (repoInfo.description) lines.push(`Description: ${repoInfo.description}`)
  if (repoInfo.language) lines.push(`Primary language: ${repoInfo.language}`)
  if (repoInfo.topics.length) lines.push(`Topics: ${repoInfo.topics.join(', ')}`)
  if (repoInfo.stars) lines.push(`Stars: ${repoInfo.stars}`)
  if (repoInfo.archived) lines.push('Status: archived')
  if (repoInfo.pushedAt) lines.push(`Last push: ${repoInfo.pushedAt}`)
  if (repoInfo.homepage) lines.push(`Homepage: ${repoInfo.homepage}`)

  return {
    title: repoName.replace(/[-_]/g, ' '),
    description: repoInfo.description ?? undefined,
    githubUrl: url,
    ...(repoInfo.homepage ? { homepageUrl: repoInfo.homepage } : {}),
    keywords: repoInfo.topics,
    rawHtml: lines.join('\n'),
  }
}

/** Parse a YouTube video ID from standard watch/short URLs. */
function parseYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      const shorts = u.pathname.match(/^\/shorts\/([^/?#]+)/)
      if (shorts) return shorts[1]
    }
  } catch { /* ignore */ }
  return null
}

/** Parse a YouTube playlist ID from playlist URLs. */
function parseYouTubePlaylistId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('list')
  } catch { /* ignore */ }
  return null
}

/** Returns true if the URL is a YouTube video or playlist. */
export function isYouTubeUrl(url: string): boolean {
  return parseYouTubeVideoId(url) !== null || parseYouTubePlaylistId(url) !== null
}

/**
 * Fetch metadata for a YouTube video or playlist via the Data API v3.
 * Falls back to politeFetch HTML scraping if YOUTUBE_API_KEY is not set.
 */
async function extractYouTubeMetadata(url: string): Promise<RawCandidateMetadata> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    // No API key — fall through to generic HTML extraction below
    return {}
  }

  const videoId = parseYouTubeVideoId(url)
  const playlistId = parseYouTubePlaylistId(url)

  if (videoId) {
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId)}&part=snippet&key=${apiKey}`
    try {
      const res = await politeFetch(apiUrl)
      if (!res.ok) {
        console.warn(`[extract] YouTube API HTTP ${res.status} for video ${videoId}`)
        return {}
      }
      const data = await res.json() as { items?: { snippet: { title: string; description: string; channelTitle: string; tags?: string[] } }[] }
      const item = data.items?.[0]
      if (!item) return {}
      const { title, description, channelTitle, tags = [] } = item.snippet
      const rawHtml = [
        `Title: ${title}`,
        `Channel: ${channelTitle}`,
        description ? `Description: ${description}` : '',
        tags.length ? `Tags: ${tags.join(', ')}` : '',
      ].filter(Boolean).join('\n')
      return { title, description, keywords: tags, rawHtml }
    } catch (err) {
      console.error(`[extract] YouTube API error for video ${videoId}:`, err)
      return {}
    }
  }

  if (playlistId) {
    const apiUrl = `https://www.googleapis.com/youtube/v3/playlists?id=${encodeURIComponent(playlistId)}&part=snippet&key=${apiKey}`
    try {
      const res = await politeFetch(apiUrl)
      if (!res.ok) {
        console.warn(`[extract] YouTube API HTTP ${res.status} for playlist ${playlistId}`)
        return {}
      }
      const data = await res.json() as { items?: { snippet: { title: string; description: string; channelTitle: string } }[] }
      const item = data.items?.[0]
      if (!item) return {}
      const { title, description, channelTitle } = item.snippet
      const rawHtml = [
        `Playlist: ${title}`,
        `Channel: ${channelTitle}`,
        description ? `Description: ${description}` : '',
      ].filter(Boolean).join('\n')
      return { title, description, rawHtml }
    } catch (err) {
      console.error(`[extract] YouTube API error for playlist ${playlistId}:`, err)
      return {}
    }
  }

  return {}
}

// #region title normalisation
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', hellip: '…', middot: '·',
  trade: '™', reg: '®', copy: '©',
}

function fromCodePointSafe(cp: number): string {
  try { return String.fromCodePoint(cp) } catch { return '' }
}

/** Decode the HTML entities that survive og:title/attribute extraction (named + numeric). */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => fromCodePointSafe(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => fromCodePointSafe(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Separators that, followed by a short tail, almost always mean "Title <sep> SiteName".
const SITE_SEP_CHARS = '|·»'

/**
 * Clean a scraped page title: decode entities, collapse whitespace, and strip a trailing
 * site-name suffix ("Foo | SiteName", "Foo — SiteName"). Conservative: strips an exact
 * og:site_name match, or a short trailing segment after a pipe/middot when a multi-word
 * head remains — so real names like "Robot | Simulator" are left intact.
 */
export function normalizeTitle(raw: string, siteName?: string): string {
  let t = decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim()

  // Strip an explicit trailing "<sep> <og:site_name>" — we know the exact site name here,
  // so any common separator is safe to remove.
  const site = siteName?.trim()
  if (site) {
    const re = new RegExp(`\\s*[|\\-–—·»:]\\s*${escapeRegExp(site)}\\s*$`, 'i')
    t = t.replace(re, '').trim()
  }

  // Generic fallback: strip a short trailing "<pipe/middot> <site-ish tail>" only if the
  // remaining head still has multiple words (guards against gutting short real names).
  const sepRe = new RegExp(`\\s*[${SITE_SEP_CHARS}]\\s*[^${SITE_SEP_CHARS}]{1,40}$`)
  const stripped = t.replace(sepRe, '').trim()
  if (stripped !== t && /\s/.test(stripped) && stripped.length >= 3) t = stripped

  return t
}
// #endregion

// #region github link picker
/**
 * Picking the page's GitHub repo is the single most consequential thing this
 * file does, because everything downstream treats that repo as the page's
 * identity: enrich.ts fetches it and backfills its description, homepage and
 * topics, and publish.ts writes its star count as the listing's popularity.
 *
 * Taking the first github.com anchor in document order got that wrong in the
 * worst possible way. On a Docusaurus or GitBook page the first one is the
 * navbar link, identical on every page of the site, so four hundred doc pages
 * all claimed to be the project. On a Read the Docs page it is the footer theme
 * credit, which is how a VScouter page came to hold 5075 stars belonging to
 * readthedocs/sphinx_rtd_theme and led the home page.
 *
 * Two signals decide it, and the second matters more than it looks. Chrome
 * versus content is the obvious one. The other is where in the repo the link
 * points: a page that IS the project links the repo root, while a page ABOUT
 * the project links into it, at /releases, /issues, or a line of a file. Real
 * pages checked while writing this: the AdvantageKit installation page links
 * only /releases, its template page links a #L90 line anchor, the PhotonVision
 * quick-install page links /releases/latest. None of them links the root, and
 * every one of them had been indexed as its own tool holding the repo's stars.
 *
 * So a repo root in the page's own content is this page's repo. A root in the
 * chrome counts only on a site's front page, which is where a project's home
 * page keeps its GitHub button. Everything else is a reference, not an
 * identity, and is returned separately so the dedup gate can still use it.
 */

/** Host labels that say nothing about which project a page belongs to. */
const GENERIC_HOST_LABELS = new Set([
  'www', 'docs', 'doc', 'documentation', 'wiki', 'guide', 'guides', 'help', 'support',
  'app', 'apps', 'web', 'site', 'sites', 'page', 'pages', 'blog', 'api', 'dev', 'io',
  'com', 'org', 'net', 'edu', 'co', 'uk', 'us', 'me', 'info', 'xyz', 'tech', 'tools',
  'github', 'gitbook', 'readthedocs', 'netlify', 'vercel', 'herokuapp', 'firebaseapp',
  'gitlab', 'sourceforge', 'notion', 'gitee', 'surge', 'render', 'fly', 'workers',
])

/** Words too common in a page title to prove a repo belongs to that page. */
const GENERIC_TITLE_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'your', 'our', 'you', 'this', 'that', 'are',
  'docs', 'doc', 'documentation', 'home', 'welcome', 'guide', 'guides', 'intro',
  'introduction', 'overview', 'getting', 'started', 'install', 'installation', 'setup',
  'usage', 'reference', 'api', 'app', 'web', 'tool', 'tools', 'project', 'projects',
  'robot', 'robotics', 'first', 'frc', 'ftc', 'fll', 'team', 'teams', 'code', 'library',
  'page', 'site', 'new', 'how', 'what', 'why', 'use', 'using', 'about',
])

/**
 * github.com paths whose first segment is a site feature rather than an owner.
 * "github.com/orgs/frc" looks exactly like owner/repo to a two-segment regex.
 */
const GITHUB_RESERVED_OWNERS = new Set([
  'orgs', 'users', 'sponsors', 'topics', 'collections', 'settings', 'features',
  'marketplace', 'apps', 'about', 'pricing', 'login', 'join', 'search', 'explore',
  'notifications', 'codespaces', 'enterprise', 'site', 'security', 'contact', 'blog',
  'readme', 'account', 'new', 'stars', 'trending', 'events', 'sitemap',
])

/** Lowercase alphanumerics only, so "AdvantageKit", "advantage-kit" and "advantage_kit" agree. */
function alphaNumeric(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Distinctive labels of a hostname, e.g. "docs.advantagekit.org" gives ["advantagekit"]. */
function hostTokens(hostname: string): string[] {
  return hostname
    .toLowerCase()
    .split('.')
    .filter((label) => label.length >= 4 && !GENERIC_HOST_LABELS.has(label))
    .map(alphaNumeric)
    .filter(Boolean)
}

/** Distinctive words of a page title. */
function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !GENERIC_TITLE_WORDS.has(word))
    .filter(Boolean)
}

/**
 * Does this repo plausibly belong to the page it was found on? True when the
 * owner or the repo name shares a distinctive token with the page's hostname or
 * its title.
 */
export function isRelatedRepo(githubUrl: string, pageUrl: string, title: string): boolean {
  const parsed = parseGitHubUrl(githubUrl)
  if (!parsed) return false

  const owner = alphaNumeric(parsed.owner)
  const repo = alphaNumeric(parsed.repo)
  if (!owner && !repo) return false

  let tokens: string[] = []
  try {
    tokens = hostTokens(new URL(pageUrl).hostname)
  } catch {
    tokens = []
  }
  tokens = [...tokens, ...titleTokens(title)]

  for (const token of tokens) {
    if (token.length < 4) continue
    if (owner.includes(token) || token.includes(owner)) return true
    if (repo.includes(token) || token.includes(repo)) return true
  }

  // A repo name written out in the title as separate words, e.g. the page
  // "FRC API for Google Sheets" and the repo FRC-API-for-Google-Sheets.
  const flatTitle = alphaNumeric(title)
  if (repo.length >= 6 && flatTitle.includes(repo)) return true

  return false
}

/** True for github.com/owner/repo itself, false for anything deeper inside it. */
export function isRepoRootUrl(githubUrl: string): boolean {
  try {
    const u = new URL(githubUrl)
    if (u.hostname.toLowerCase().replace(/^www\./, '') !== 'github.com') return false
    const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/')
    return parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1])
  } catch {
    return false
  }
}

/** True when the URL addresses a site's front page rather than a page within it. */
function isSiteRoot(pageUrl: string): boolean {
  try {
    return new URL(pageUrl).pathname.replace(/\/+$/, '').length === 0
  } catch {
    return false
  }
}

interface RepoLink {
  href: string
  inContent: boolean
}

/** Every github.com repo link under an element, in document order, deduplicated. */
function repoLinksIn(root: HTMLElement): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const a of root.querySelectorAll('a[href*="github.com"]')) {
    const href = (a.getAttribute('href') ?? '').trim()
    if (!/github\.com\/[^/]+\/[^/]+/.test(href)) continue
    if (!href.startsWith('http')) continue
    const parsed = parseGitHubUrl(href)
    if (!parsed || GITHUB_RESERVED_OWNERS.has(parsed.owner.toLowerCase())) continue
    const key = href.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(href)
  }
  return out
}

export interface GitHubLinkPick {
  /** The repo we are willing to treat as this page's own. */
  githubUrl?: string
  /**
   * A repo the page links but that we refuse to treat as its identity: a navbar
   * or footer link, or a link into the repo rather than to it. Never used to
   * enrich the listing. It is still the clearest evidence that the page belongs
   * to an already-listed tool, which is all the dedup gate in enrich.ts wants.
   */
  referencedGitHubUrl?: string
}

/**
 * Choose the GitHub repo for a page. Returns nothing rather than guessing: a
 * listing with a missing link is one edit away from correct and is visibly
 * incomplete in the admin, while a listing wearing another project's stars is
 * invisible and quietly corrupts the ranking.
 */
export function pickGitHubUrl(html: string, pageUrl: string, title: string): GitHubLinkPick {
  let links: RepoLink[] = []
  try {
    const all = repoLinksIn(parse(html))
    if (all.length === 0) return {}
    const content = mainContentRoot(html)
    const inContent = new Set((content ? repoLinksIn(content) : []).map((h) => h.toLowerCase()))
    links = all.map((href) => ({ href, inContent: inContent.has(href.toLowerCase()) }))
  } catch {
    return {}
  }
  if (links.length === 0) return {}

  const related = (l: RepoLink) => isRelatedRepo(l.href, pageUrl, title)
  const root = (l: RepoLink) => isRepoRootUrl(l.href)

  // The repo root, in the page's own content, that has something to do with the
  // page. This is a project home page linking its own source.
  const best = links.find((l) => l.inContent && root(l) && related(l))
    // An unrelated repo root in the content is still a deliberate link to a
    // whole project, which a "see also" list of one is indistinguishable from.
    // Accept it only when nothing related was found anywhere on the page.
    ?? (links.some(related) ? undefined : links.find((l) => l.inContent && root(l)))
    // A project's home page keeps its GitHub button in the navbar. That is fine
    // on the front page of a site and never fine on a page within it, which is
    // exactly where a docs theme repeats the same link.
    ?? (isSiteRoot(pageUrl) ? links.find((l) => root(l) && related(l)) : undefined)

  if (best) return { githubUrl: best.href }

  // Nothing we will stand behind. Keep the most informative one as a hint.
  const hint = links.find((l) => related(l) && root(l))
    ?? links.find((l) => related(l))
    ?? links.find((l) => root(l))
    ?? links[0]
  return { referencedGitHubUrl: hint.href }
}
// #endregion

export async function extractMetadata(url: string): Promise<RawCandidateMetadata> {
  // GitHub repo URLs — use API, not HTML (HTML gives GitHub's own chrome, not repo data)
  if (parseGitHubUrl(url)) {
    return extractGitHubMetadata(url)
  }

  // YouTube videos/playlists — use Data API v3 to avoid 429s from HTML scraping
  if (isYouTubeUrl(url)) {
    const ytMeta = await extractYouTubeMetadata(url)
    // If we got useful data from the API, return it; otherwise fall through to HTML
    if (ytMeta.title) return ytMeta
  }

  // Chrome Web Store — derive extension name from the URL slug before HTML extraction.
  // CWS serves generic meta tags ("Chrome Web Store") instead of the extension name.
  let cwsDerivedTitle: string | undefined
  const cwsMatch = url.match(/^https?:\/\/chrome\.google\.com\/webstore\/detail\/([^/?#]+)/)
  if (cwsMatch?.[1]) {
    cwsDerivedTitle = cwsMatch[1]
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }

  try {
    const res = await politeFetch(url)
    if (!res.ok) {
      console.warn(`[extract] HTTP ${res.status} for ${url}`)
      return {}
    }

    const html = await res.text()
    const root = parse(html)

    // Title: prefer og:title > title tag; fall back to CWS-derived slug title if generic.
    // Normalise first — decode HTML entities and strip trailing "| SiteName" chrome, using
    // og:site_name as the strongest signal for what to strip.
    const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content')
    const titleTag = root.querySelector('title')?.innerText
    const siteName = root.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ?? undefined
    const rawTitle = normalizeTitle(ogTitle ?? titleTag ?? '', siteName).slice(0, 300)
    const isGenericCwsTitle = cwsDerivedTitle && (!rawTitle || /^chrome web store$/i.test(rawTitle))
    const title = isGenericCwsTitle ? cwsDerivedTitle! : rawTitle

    // Description
    const ogDesc = root.querySelector('meta[property="og:description"]')?.getAttribute('content')
    const metaDesc = root.querySelector('meta[name="description"]')?.getAttribute('content')
    const description = decodeHtmlEntities((ogDesc ?? metaDesc ?? '').trim()).slice(0, 1000)

    // Keywords
    const kwContent = root.querySelector('meta[name="keywords"]')?.getAttribute('content') ?? ''
    const keywords = kwContent
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 20)

    // Find this page's own GitHub repo, ignoring chrome and deep links.
    const { githubUrl, referencedGitHubUrl } = pickGitHubUrl(html, url, title)

    // Find docs links (heuristic)
    const docsLinks = root
      .querySelectorAll('a[href*="docs."], a[href*="/docs"], a[href*="documentation"]')
      .map((a) => a.getAttribute('href') ?? '')
      .filter(Boolean)
      .slice(0, 2)

    // Extract readable page text for AI classification.
    // Remove non-content elements first, then get structured text.
    const bodyClone = root.querySelector('body') ?? root
    for (const el of bodyClone.querySelectorAll('script, style, noscript, svg, iframe, nav, footer')) {
      el.remove()
    }
    const pageText = bodyClone.structuredText
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 20000)

    return {
      title,
      description,
      ogDescription: ogDesc ?? undefined,
      githubUrl,
      referencedGitHubUrl,
      docsUrl: docsLinks[0],
      keywords,
      rawHtml: pageText || undefined,
    }
  } catch (err) {
    console.error(`[extract] error for ${url}:`, err)
    return {}
  }
}

/** Derive canonical URL from a raw URL (strip query params, normalize, etc.) */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    // Strip tracking params
    const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'source']
    for (const param of TRACKING_PARAMS) {
      u.searchParams.delete(param)
    }
    // Remove trailing slash from path (unless it's root)
    if (u.pathname.endsWith('/') && u.pathname !== '/') {
      u.pathname = u.pathname.slice(0, -1)
    }
    // Force lowercase hostname
    u.hostname = u.hostname.toLowerCase()
    return u.toString()
  } catch {
    return rawUrl
  }
}
