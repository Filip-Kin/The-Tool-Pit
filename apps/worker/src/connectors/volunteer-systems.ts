/**
 * Connector for https://volunteer.systems/index.html
 * Similar approach to fta-tools: fetch, parse, extract tool links.
 */
import { parse } from 'node-html-parser'
import { type Connector, type ConnectorResult, type CandidateInput, politeFetch } from './base.js'

const BASE_URL = 'https://volunteer.systems/index.html'

/** Same URL quality filter as fta-tools: only allow real tool URLs, not GitHub nav/chrome */
function isValidToolUrl(url: string): boolean {
  if (url.includes('github.com')) {
    if (!/^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(url)) return false
  }
  const BLOCKED = [
    'github.com/features', 'github.com/about', 'github.com/pricing',
    'github.com/contact', 'github.com/login', 'github.com/signup',
    'github.com/marketplace', 'github.com/explore', 'github.com/orgs',
    'docs.github.com', 'help.github.com', 'status.github.com',
    'education.github.com', 'raw.githubusercontent.com',
  ]
  return !BLOCKED.some(k => url.includes(k))
}

export class VolunteerSystemsConnector implements Connector {
  name = 'volunteer_systems'
  /** Disabled: volunteer.systems returns 0 results (site unavailable or changed structure) */
  disabled = true

  async run(): Promise<ConnectorResult> {
    const candidates: CandidateInput[] = []
    const errors: string[] = []

    try {
      const res = await politeFetch(BASE_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const html = await res.text()
      const root = parse(html)

      const seen = new Set<string>()

      // Extract all external tool links
      for (const link of root.querySelectorAll('a[href^="http"]')) {
        const href = link.getAttribute('href')
        if (!href || href.includes('volunteer.systems')) continue
        try { new URL(href) } catch { continue }
        if (!isValidToolUrl(href)) continue
        if (seen.has(href)) continue
        seen.add(href)

        const title = link.innerText.trim()
        if (!title || title.length < 2) continue

        candidates.push({
          sourceUrl: BASE_URL,
          canonicalUrl: href,
          title,
          githubUrl: href.includes('github.com') ? href : undefined,
        })
      }

      console.log(`[volunteer-systems] found ${candidates.length} candidates`)
    } catch (err) {
      errors.push(String(err))
      console.error('[volunteer-systems] error:', err)
    }

    return {
      candidates,
      stats: { discovered: candidates.length, skipped: 0, errors },
    }
  }
}
