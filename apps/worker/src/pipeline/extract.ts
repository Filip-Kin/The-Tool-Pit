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
 */
async function extractGitHubMetadata(url: string): Promise<RawCandidateMetadata> {
  const repoInfo = await fetchGitHubRepo(url)
  if (!repoInfo) return { githubUrl: url }

  const repoName = repoInfo.fullName.split('/')[1] ?? repoInfo.fullName
  return {
    title: repoName.replace(/[-_]/g, ' '),
    description: repoInfo.description ?? undefined,
    githubUrl: url,
    ...(repoInfo.homepage ? { homepageUrl: repoInfo.homepage } : {}),
    keywords: repoInfo.topics,
  }
}

export async function extractMetadata(url: string): Promise<RawCandidateMetadata> {
  // GitHub repo URLs — use API, not HTML (HTML gives GitHub's own chrome, not repo data)
  if (parseGitHubUrl(url)) {
    return extractGitHubMetadata(url)
  }

  try {
    const res = await politeFetch(url)
    if (!res.ok) {
      console.warn(`[extract] HTTP ${res.status} for ${url}`)
      return {}
    }

    const html = await res.text()
    const root = parse(html)

    // Title: prefer og:title > title tag
    const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content')
    const titleTag = root.querySelector('title')?.innerText
    const title = (ogTitle ?? titleTag ?? '').trim().slice(0, 300)

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

    return {
      title,
      description,
      ogDescription: ogDesc ?? undefined,
      githubUrl,
      docsUrl: docsLinks[0],
      keywords,
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
