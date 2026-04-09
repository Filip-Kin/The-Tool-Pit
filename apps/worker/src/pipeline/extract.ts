/**
 * HTML metadata extraction.
 * Deterministic first — no AI at this stage.
 */
import { parse } from 'node-html-parser'
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

    // Title: prefer og:title > title tag; fall back to CWS-derived slug title if generic
    const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content')
    const titleTag = root.querySelector('title')?.innerText
    const rawTitle = (ogTitle ?? titleTag ?? '').trim().slice(0, 300)
    const isGenericCwsTitle = cwsDerivedTitle && (!rawTitle || /^chrome web store$/i.test(rawTitle))
    const title = isGenericCwsTitle ? cwsDerivedTitle! : rawTitle

    // Description
    const ogDesc = root.querySelector('meta[property="og:description"]')?.getAttribute('content')
    const metaDesc = root.querySelector('meta[name="description"]')?.getAttribute('content')
    const description = (ogDesc ?? metaDesc ?? '').trim().slice(0, 1000)

    // Keywords
    const kwContent = root.querySelector('meta[name="keywords"]')?.getAttribute('content') ?? ''
    const keywords = kwContent
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 20)

    // Find GitHub links on the page
    const githubLinks = root
      .querySelectorAll('a[href*="github.com"]')
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => /github\.com\/[^/]+\/[^/]+/.test(href))
      .slice(0, 3)

    const githubUrl = githubLinks[0] ?? undefined

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
