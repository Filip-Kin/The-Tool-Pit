/**
 * Awesome-list connector.
 * Fetches a GitHub "awesome-*" README (via raw.githubusercontent.com) and
 * parses all markdown links as tool candidates.
 *
 * Why this works well:
 *   Awesome lists are curated by humans, so link quality is high.
 *   The section headings give us context (e.g. "Scouting", "Vision", "CAD").
 *
 * Currently configured lists:
 *   andrewda/awesome-frc  (FRC tools)
 */
import { type Connector, type ConnectorResult, type CandidateInput, politeFetch, delay } from './base.js'

interface AwesomeListSource {
  /** e.g. "andrewda/awesome-frc" */
  repo: string
  /** Path to the README inside the repo, e.g. "readme.md" */
  path?: string
  /** Default program to tag candidates with if we can't infer from context */
  program: 'frc' | 'ftc' | 'fll'
}

const AWESOME_LISTS: AwesomeListSource[] = [
  { repo: 'andrewda/awesome-frc', path: 'readme.md', program: 'frc' },
]

/** Markdown link: [text](url) */
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g

/** Section heading: ## Heading or ### Heading */
const HEADING_RE = /^#{1,4}\s+(.+)$/

/** Returns true if the URL is a real tool/project and not a list-meta link */
function isToolUrl(url: string): boolean {
  const BLOCKED = [
    'github.com/sindresorhus/awesome',
    'github.com/features',
    'github.com/about',
    'awesome.re',
    'shields.io',
    'img.shields.io',
    'travis-ci.org',
    'travis-ci.com',
    'circleci.com',
    'badge',
  ]
  if (BLOCKED.some(b => url.includes(b))) return false
  // Block non-repo GitHub paths (issues, PRs, wikis, etc.)
  if (url.includes('github.com')) {
    const ghPath = new URL(url).pathname.replace(/^\//, '').split('/')
    if (ghPath.length >= 2) {
      const sub = ghPath[2]
      if (sub && ['issues', 'pull', 'wiki', 'actions', 'releases', 'commit'].includes(sub)) return false
    } else {
      // github.com/org only, no repo
      return false
    }
  }
  return true
}

export class AwesomeListConnector implements Connector {
  name = 'awesome_list'

  async run(): Promise<ConnectorResult> {
    const candidates: CandidateInput[] = []
    const errors: string[] = []
    const seen = new Set<string>()

    for (const source of AWESOME_LISTS) {
      const path = source.path ?? 'readme.md'
      // Use the default branch shortcut via raw.githubusercontent.com
      const rawUrl = `https://raw.githubusercontent.com/${source.repo}/HEAD/${path}`

      try {
        const res = await politeFetch(rawUrl)
        if (!res.ok) {
          const msg = `[awesome-list] HTTP ${res.status} for ${rawUrl}`
          console.warn(msg)
          errors.push(msg)
          continue
        }

        const markdown = await res.text()
        const lines = markdown.split('\n')
        let currentSection = ''

        for (const line of lines) {
          // Track the current section heading — used as description context
          const headingMatch = HEADING_RE.exec(line)
          if (headingMatch) {
            currentSection = headingMatch[1].trim()
            continue
          }

          // Extract all [text](url) links from the line
          let match: RegExpExecArray | null
          MD_LINK_RE.lastIndex = 0
          while ((match = MD_LINK_RE.exec(line)) !== null) {
            const [, text, url] = match
            if (!url || !isToolUrl(url)) continue

            // Normalise URL: strip trailing # anchors and tracking params
            let cleanUrl: string
            try {
              const u = new URL(url)
              u.hash = ''
              cleanUrl = u.toString().replace(/\/$/, '') || url
            } catch {
              continue
            }

            if (seen.has(cleanUrl)) continue
            seen.add(cleanUrl)

            // Build a description from the surrounding line text minus the link itself
            const lineDesc = line
              .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // collapse other links to text
              .replace(/^[-*]\s*/, '')                   // strip list bullet
              .trim()
              .slice(0, 300)

            candidates.push({
              sourceUrl: `https://github.com/${source.repo}`,
              canonicalUrl: cleanUrl,
              title: text.trim(),
              description: lineDesc !== text.trim() ? lineDesc : undefined,
              githubUrl: cleanUrl.includes('github.com') ? cleanUrl : undefined,
              keywords: [source.program, currentSection.toLowerCase()].filter(Boolean),
              notes: `Sourced from awesome-list: ${source.repo} § ${currentSection}`,
            })
          }
        }

        console.log(`[awesome-list] ${source.repo} → ${candidates.length} candidates so far`)
        await delay(1000)
      } catch (err) {
        const msg = String(err)
        errors.push(msg)
        console.error(`[awesome-list] error for ${source.repo}:`, err)
      }
    }

    return {
      candidates,
      stats: { discovered: candidates.length, skipped: 0, errors },
    }
  }
}
