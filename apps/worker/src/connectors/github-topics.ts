/**
 * GitHub Topics connector.
 * Uses the GitHub Search API to find repos tagged with FIRST Robotics topics.
 * Returns top repos sorted by stars — these are real, high-quality candidates.
 *
 * Topics searched:
 *   frc, first-robotics-competition
 *   ftc, first-tech-challenge
 *   fll, first-lego-league
 */
import { type Connector, type ConnectorResult, type CandidateInput, politeFetch, delay } from './base.js'

const GITHUB_SEARCH = 'https://api.github.com/search/repositories'

/** Topics to search and the FIRST program they map to. */
const TOPIC_TARGETS = [
  { topic: 'frc',                        program: 'frc' },
  { topic: 'first-robotics-competition', program: 'frc' },
  { topic: 'ftc',                        program: 'ftc' },
  { topic: 'first-tech-challenge',       program: 'ftc' },
  { topic: 'fll',                        program: 'fll' },
  { topic: 'first-lego-league',          program: 'fll' },
] as const

/** Max repos to fetch per topic. 100 is the GitHub Search API maximum per page. */
const PER_TOPIC = 100

/** CAD-related keywords used to detect robot CAD repos. */
const CAD_KEYWORDS = ['cad', 'onshape', 'solidworks', 'fusion', 'step', 'stp', 'design', 'mechanical']

interface GitHubSearchRepo {
  html_url: string
  full_name: string
  name: string
  description: string | null
  homepage: string | null
  stargazers_count: number
  topics: string[]
  pushed_at: string
  archived: boolean
}

/**
 * Extracts team number and season year metadata from a repo's full_name,
 * name, topics, and description. Returns structured keyword strings so the
 * publish pipeline can store `isTeamCad` and relate repos to specific teams.
 *
 * Examples:
 *   full_name "frc1678/2024Robot"  → ['team:1678', 'year:2024', 'team_code']
 *   topics    ['frc-4099', 'cad']  → ['team:4099', 'team_cad']
 */
function extractRepoKeywords(repo: GitHubSearchRepo, program: string): string[] {
  const extra: string[] = []

  const [orgPart] = repo.full_name.split('/')
  const nameLower = repo.name.toLowerCase()
  const descLower = (repo.description ?? '').toLowerCase()
  const topicsLower = repo.topics.map((t) => t.toLowerCase())
  const combinedText = `${nameLower} ${descLower} ${topicsLower.join(' ')}`

  // --- Team number ---
  // 1. frc-NNNN topic pattern (most reliable)
  let teamNumber: number | null = null
  for (const t of topicsLower) {
    const m = t.match(/^frc-(\d{1,5})$/)
    if (m) { teamNumber = parseInt(m[1], 10); break }
  }
  // 2. Org name pattern like "frc1678" or "team1678"
  if (!teamNumber) {
    const m = orgPart.match(/(?:frc|team)(\d{1,5})/i)
    if (m) teamNumber = parseInt(m[1], 10)
  }
  if (teamNumber) extra.push(`team:${teamNumber}`)

  // --- Season year ---
  const yearMatch = repo.name.match(/\b(20\d{2})\b/)
  if (yearMatch) extra.push(`year:${yearMatch[1]}`)

  // --- CAD vs code detection ---
  const isCad = CAD_KEYWORDS.some((k) => combinedText.includes(k))
  if (isCad) {
    extra.push('team_cad')
  } else if (teamNumber || yearMatch) {
    // Only tag team_code when we also detected a team/year (likely a robot code repo)
    extra.push('team_code')
  }

  // Always add the program keyword if not already in topics
  if (!repo.topics.includes(program)) extra.push(program)

  return extra
}

export class GitHubTopicsConnector implements Connector {
  name = 'github_topics'

  async run(): Promise<ConnectorResult> {
    const candidates: CandidateInput[] = []
    const errors: string[] = []
    const seen = new Set<string>()

    const token = process.env.GITHUB_TOKEN
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'TheToolPit/1.0 (+https://thetoolpit.com)',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    for (const { topic, program } of TOPIC_TARGETS) {
      try {
        const url =
          `${GITHUB_SEARCH}?q=topic:${topic}+is:public&sort=stars&order=desc&per_page=${PER_TOPIC}`

        const res = await politeFetch(url, { headers })
        if (!res.ok) {
          const msg = `[github-topics] HTTP ${res.status} for topic:${topic}`
          console.warn(msg)
          errors.push(msg)
          // Respect rate limit headers
          await delay(2000)
          continue
        }

        const data = await res.json() as { items: GitHubSearchRepo[] }
        const repos = data.items ?? []

        for (const repo of repos) {
          if (repo.archived) continue
          const repoUrl = repo.html_url
          if (seen.has(repoUrl)) continue
          seen.add(repoUrl)

          const extraKeywords = extractRepoKeywords(repo, program)
          candidates.push({
            sourceUrl: `https://github.com/topics/${topic}`,
            canonicalUrl: repoUrl,
            githubUrl: repoUrl,
            title: repo.name.replace(/[-_]/g, ' '),
            description: repo.description ?? undefined,
            ...(repo.homepage ? { homepageUrl: repo.homepage } : {}),
            // Pre-seed keywords: GitHub topics + extracted team/year/CAD metadata
            keywords: [...new Set([...repo.topics, ...extraKeywords])],
          })
        }

        console.log(`[github-topics] topic:${topic} → ${repos.length} repos`)

        // GitHub Search API has a 30 req/min rate limit for authenticated, 10 for unauthenticated
        await delay(token ? 2500 : 7000)
      } catch (err) {
        const msg = String(err)
        errors.push(msg)
        console.error(`[github-topics] error for topic:${topic}:`, err)
      }
    }

    const skipped = 0
    console.log(`[github-topics] total: ${candidates.length} unique candidates`)
    return {
      candidates,
      stats: { discovered: candidates.length, skipped, errors },
    }
  }
}
