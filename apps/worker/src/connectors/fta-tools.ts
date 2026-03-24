/**
 * Connector for https://fta.tools/
 * Scrapes the tool listing and extracts tool entries.
 *
 * Strategy: fetch the page, parse tool links deterministically,
 * then enqueue enrichment for each candidate.
 */
import { parse } from 'node-html-parser'
import { type Connector, type ConnectorResult, type CandidateInput, politeFetch, delay } from './base.js'

const FTA_TOOLS_URL = 'https://fta.tools/'

/**
 * Returns true only if the URL could represent a real tool/project.
 * Rejects GitHub nav pages, issue trackers, CI links, and other junk.
 */
function isValidToolUrl(url: string): boolean {
  // GitHub URLs must be exactly github.com/owner/repo (no sub-paths)
  if (url.includes('github.com')) {
    if (!/^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(url)) return false
  }
  // Reject common junk patterns across any site
  const BLOCKED = [
    'github.com/features', 'github.com/about', 'github.com/pricing',
    'github.com/contact', 'github.com/login', 'github.com/signup',
    'github.com/marketplace', 'github.com/explore', 'github.com/orgs',
    'docs.github.com', 'help.github.com', 'status.github.com',
    'education.github.com', 'raw.githubusercontent.com',
  ]
  return !BLOCKED.some(k => url.includes(k))
}

export class FtaToolsConnector implements Connector {
  name = 'fta_tools'

  async run(): Promise<ConnectorResult> {
    const candidates: CandidateInput[] = []
    const errors: string[] = []

    try {
      const res = await politeFetch(FTA_TOOLS_URL)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${FTA_TOOLS_URL}`)
      }

      const html = await res.text()
      const root = parse(html)

      // fta.tools lists tools as anchor tags or cards — adapt selector as needed
      // This is a conservative extraction: we look for any external links
      const links = root.querySelectorAll('a[href^="http"]')

      const seen = new Set<string>()

      for (const link of links) {
        const href = link.getAttribute('href')
        if (!href) continue

        // Skip self-referential links and CDN/asset links
        if (href.includes('fta.tools') || href.includes('cdn.') || href.includes('fonts.')) continue

        // Skip mailto, javascript, etc.
        try { new URL(href) } catch { continue }

        // Skip garbage GitHub nav/meta/issues pages — only real repo URLs
        if (!isValidToolUrl(href)) continue

        if (seen.has(href)) continue
        seen.add(href)

        const title = link.innerText.trim()
        const parentText = link.parentNode?.innerText?.trim() ?? ''

        // Only include links that look like tool references (have some text context)
        if (!title || title.length < 2) continue

        candidates.push({
          sourceUrl: FTA_TOOLS_URL,
          canonicalUrl: href,
          title,
          description: parentText !== title ? parentText.slice(0, 500) : undefined,
          githubUrl: href.includes('github.com') ? href : undefined,
        })
      }

      console.log(`[fta-tools] found ${candidates.length} candidates`)
    } catch (err) {
      errors.push(String(err))
      console.error('[fta-tools] error:', err)
    }

    return {
      candidates,
      stats: { discovered: candidates.length, skipped: 0, errors },
    }
  }
}
