/**
 * TBA (The Blue Alliance) Teams connector.
 * Paginates the TBA v3 /teams endpoint to discover FRC team GitHub organizations.
 * For each team that has a GitHub URL in their `website` field, enumerates
 * their public repos to find robot code and robot CAD repos.
 *
 * Required env vars:
 *   TBA_API_KEY    — The Blue Alliance API key (https://www.thebluealliance.com/account)
 *   GITHUB_TOKEN   — (optional) GitHub PAT for higher rate limits
 */
import { type Connector, type ConnectorResult, type CandidateInput, politeFetch, delay } from './base.js'

const TBA_BASE = 'https://www.thebluealliance.com/api/v3'
const GITHUB_API = 'https://api.github.com'

/** Keywords in repo names/descriptions that suggest robot code (not CAD). */
const CODE_KEYWORDS = ['robot', 'code', 'java', 'kotlin', 'python', 'cpp', 'wpilib', 'command']
/** Keywords that strongly suggest CAD / design files. */
const CAD_KEYWORDS = ['cad', 'onshape', 'solidworks', 'fusion', 'step', 'stp', 'design', 'mechanical']

interface TbaTeam {
  team_number: number
  nickname: string
  website: string | null
}

interface GitHubRepo {
  name: string
  full_name: string
  html_url: string
  description: string | null
  homepage: string | null
  stargazers_count: number
  topics: string[]
  archived: boolean
  pushed_at: string
}

/**
 * Returns the GitHub org/user name from a website URL if it points to GitHub,
 * or null otherwise.
 */
function extractGitHubOrg(website: string | null): string | null {
  if (!website) return null
  try {
    const u = new URL(website)
    if (u.hostname !== 'github.com') return null
    // Expect path /<org> (one segment, no trailing slashes)
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length === 1) return parts[0]
    return null
  } catch {
    return null
  }
}

/** Infer season year from repo name (e.g. "2024Robot" → 2024). */
function inferYear(repoName: string): number | null {
  const m = repoName.match(/\b(20\d{2})\b/)
  return m ? parseInt(m[1], 10) : null
}

/** Returns true if the repo looks like robot code. */
function isRobotCode(repo: GitHubRepo): boolean {
  const text = `${repo.name} ${repo.description ?? ''}`.toLowerCase()
  const yearPresent = /\b20\d{2}\b/.test(repo.name)
  const hasCodeKeyword = CODE_KEYWORDS.some((k) => text.includes(k))
  const hasCadKeyword = CAD_KEYWORDS.some((k) => text.includes(k))
  // If it's a CAD repo that's not also code, skip it here
  if (hasCadKeyword && !hasCodeKeyword) return false
  return yearPresent || hasCodeKeyword
}

/** Returns true if the repo looks like robot CAD. */
function isRobotCad(repo: GitHubRepo): boolean {
  const text = `${repo.name} ${repo.description ?? ''}`.toLowerCase()
  const topicText = repo.topics.join(' ').toLowerCase()
  return CAD_KEYWORDS.some((k) => text.includes(k) || topicText.includes(k))
}

export class TbaTeamsConnector implements Connector {
  name = 'tba_teams'

  async run(): Promise<ConnectorResult> {
    const tbaApiKey = process.env.TBA_API_KEY
    if (!tbaApiKey) {
      console.warn('[tba-teams] TBA_API_KEY not set — skipping')
      return { candidates: [], stats: { discovered: 0, skipped: 0, errors: ['TBA_API_KEY not set'] } }
    }

    const githubToken = process.env.GITHUB_TOKEN
    const githubHeaders: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'TheToolPit/1.0 (+https://thetoolpit.com)',
    }
    if (githubToken) githubHeaders['Authorization'] = `Bearer ${githubToken}`

    const candidates: CandidateInput[] = []
    const errors: string[] = []
    const seenRepos = new Set<string>()

    // Paginate TBA teams (page 0, 1, ... until empty array)
    let page = 0
    while (true) {
      let teams: TbaTeam[]
      try {
        const res = await politeFetch(`${TBA_BASE}/teams/${page}`, {
          headers: { 'X-TBA-Auth-Key': tbaApiKey },
        })

        if (res.status === 404 || res.status === 400) break
        if (!res.ok) {
          errors.push(`[tba-teams] HTTP ${res.status} on page ${page}`)
          break
        }

        teams = await res.json() as TbaTeam[]
        if (!teams || teams.length === 0) break
      } catch (err) {
        errors.push(`[tba-teams] error fetching teams page ${page}: ${String(err)}`)
        break
      }

      console.log(`[tba-teams] page ${page}: ${teams.length} teams`)

      for (const team of teams) {
        const org = extractGitHubOrg(team.website)
        if (!org) continue

        try {
          // Fetch all public repos for this org/user
          const reposRes = await politeFetch(
            `${GITHUB_API}/users/${encodeURIComponent(org)}/repos?type=public&per_page=100&sort=pushed`,
            { headers: githubHeaders },
          )

          if (!reposRes.ok) {
            // 404 means the org doesn't exist or was renamed — skip silently
            if (reposRes.status !== 404) {
              errors.push(`[tba-teams] GitHub HTTP ${reposRes.status} for org ${org}`)
            }
            await delay(500)
            continue
          }

          const repos = await reposRes.json() as GitHubRepo[]

          for (const repo of repos) {
            if (repo.archived) continue
            if (seenRepos.has(repo.html_url)) continue

            const isCode = isRobotCode(repo)
            const isCad = isRobotCad(repo)
            if (!isCode && !isCad) continue

            seenRepos.add(repo.html_url)

            const year = inferYear(repo.name)
            const keywords: string[] = [`team:${team.team_number}`]
            if (year) keywords.push(`year:${year}`)
            if (isCad) keywords.push('team_cad')
            if (isCode) keywords.push('team_code')
            keywords.push('frc')

            const displayName = team.nickname
              ? `Team ${team.team_number} ${team.nickname} — ${repo.name}`
              : `FRC Team ${team.team_number} — ${repo.name}`

            candidates.push({
              sourceUrl: `https://www.thebluealliance.com/team/${team.team_number}`,
              canonicalUrl: repo.html_url,
              githubUrl: repo.html_url,
              title: displayName,
              description: repo.description ?? undefined,
              ...(repo.homepage ? { homepageUrl: repo.homepage } : {}),
              keywords,
            })
          }

          // Polite delay between GitHub org lookups
          await delay(2000)
        } catch (err) {
          errors.push(`[tba-teams] error processing org ${org}: ${String(err)}`)
        }
      }

      page++
      await delay(500)
    }

    console.log(`[tba-teams] done — ${candidates.length} candidates from TBA teams`)
    return {
      candidates,
      stats: { discovered: candidates.length, skipped: 0, errors },
    }
  }
}
