/**
 * GitHub team robot code / CAD connector.
 *
 * WHY THIS EXISTS, given github-topics.ts already searches the same topics:
 * that connector runs ONE query per topic, `sort=stars&order=desc`, 100
 * results. A team's robot code repo has single-digit stars, so it is never in
 * the top 100 of `topic:frc` and never gets discovered. The archive ended up
 * with 370 CAD entries (all from the curated Spectrum list) against 29 code
 * entries, which is not a directory of team code so much as an accident.
 *
 * So this connector sorts by RECENCY and slices by season, which is the axis
 * team repos actually vary on. GitHub caps any one search at 1000 results, so
 * a single `topic:frc` query cannot reach them all; one query per season stays
 * comfortably under the cap and covers every year we care about.
 *
 * PRECISION over recall, deliberately. Only repos we can attribute to a
 * specific team number are emitted, via the org/topic patterns below. A repo
 * that is merely FRC-adjacent is left to the normal pipeline: this connector
 * is not a general tool crawler and must not become one, because everything it
 * emits skips AI classification.
 *
 * COST: zero model calls. Like spectrum_cad, jobs/enrich.ts pre-classifies
 * `github_team_code` deterministically. The team number and season come from
 * the repo's own name and topics, not from a guess, so there is nothing for a
 * model to add. That matters because this connector can return thousands of
 * candidates in one run and the Anthropic account is pay as you go.
 */
import { type Connector, type ConnectorResult, type CandidateInput, politeFetch, delay } from './base.js'

const GITHUB_SEARCH = 'https://api.github.com/search/repositories'

/** Topic per program. FLL is omitted: teams there rarely publish robot code. */
const PROGRAM_TOPICS = [
  { topic: 'frc', program: 'frc' },
  { topic: 'first-robotics-competition', program: 'frc' },
  { topic: 'ftc', program: 'ftc' },
  { topic: 'first-tech-challenge', program: 'ftc' },
] as const

/**
 * Seasons to sweep, newest first. 2015 is the floor because GitHub use in FRC
 * was thin before it and the results are mostly noise.
 */
const FIRST_SEASON = 2015

/** GitHub's hard cap on any one search is 1000 results (10 pages of 100). */
const MAX_PAGES = 10
const PER_PAGE = 100

/**
 * Authenticated search allows 30 requests/minute. 2.2s between calls keeps us
 * under it with room for the occasional retry, and a full sweep is a few
 * hundred requests, so this job is slow by design rather than bursty.
 */
const REQUEST_INTERVAL_MS = 2200

/** CAD-ish signals. A repo hitting one of these is filed as CAD, not code. */
const CAD_KEYWORDS = ['cad', 'onshape', 'solidworks', 'fusion360', 'inventor', 'step-files']

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
  fork: boolean
}

/**
 * The team number this repo belongs to, or null.
 *
 * Only patterns that NAME a team count. A four-digit number floating in a repo
 * name is not evidence: "2024Robot" is a season, not team 2024, and treating
 * it as a team is how an archive fills with wrong attributions.
 */
export function teamNumberFromRepo(fullName: string, topics: string[]): number | null {
  for (const t of topics.map((x) => x.toLowerCase())) {
    const m = t.match(/^(?:frc|ftc)-(\d{1,5})$/)
    if (m) return parseInt(m[1]!, 10)
  }

  const [orgPart = '', repoPart = ''] = fullName.split('/')
  // frc1678, team1678, frc-team-1678, ftcteam1234
  for (const part of [orgPart, repoPart]) {
    const m = part.match(/^(?:frc|ftc)[-_]?(?:team[-_]?)?(\d{1,5})$/i) ?? part.match(/^team[-_]?(\d{1,5})$/i)
    if (m) {
      const n = parseInt(m[1]!, 10)
      if (n > 0 && n < 100000) return n
    }
  }
  return null
}

/**
 * The season this repo is for.
 *
 * Prefers a year written into the repo name, because that is the team saying
 * so. Falls back to the year of the last push, which is right far more often
 * than it is wrong for a repo that is only touched during build season.
 */
export function seasonFromRepo(name: string, pushedAt: string): number | null {
  const inName = name.match(/\b(20[0-9]{2})\b/)
  if (inName) {
    const y = parseInt(inName[1]!, 10)
    if (y >= 2000 && y <= 2100) return y
  }
  const pushed = new Date(pushedAt)
  if (!Number.isNaN(pushed.getTime())) {
    const y = pushed.getUTCFullYear()
    if (y >= FIRST_SEASON) return y
  }
  return null
}

export class GitHubTeamCodeConnector implements Connector {
  name = 'github_team_code'
  /**
   * The search API already returned name, description, topics, homepage and
   * push date. Fetching each repo page again would be thousands of requests
   * for nothing.
   */
  skipExtract = true

  async run(): Promise<ConnectorResult> {
    const candidates: CandidateInput[] = []
    const errors: string[] = []
    const seen = new Set<string>()
    let discovered = 0
    let skipped = 0

    const token = process.env.GITHUB_TOKEN
    if (!token) {
      // Unauthenticated search is 10 requests/minute, which cannot complete a
      // sweep. Say so rather than half-running and looking like poor coverage.
      return { candidates: [], stats: { discovered: 0, skipped: 0, errors: ['GITHUB_TOKEN not set; team code sweep skipped'] } }
    }
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'TheToolPit/1.0 (+https://frc.tools)',
      Authorization: `Bearer ${token}`,
    }

    const thisSeason = new Date().getUTCFullYear()
    const seasons: number[] = []
    for (let y = thisSeason; y >= FIRST_SEASON; y--) seasons.push(y)

    for (const { topic, program } of PROGRAM_TOPICS) {
      for (const season of seasons) {
        for (let page = 1; page <= MAX_PAGES; page++) {
          const q = `topic:${topic}+is:public+fork:false+pushed:${season}-01-01..${season}-12-31`
          const url = `${GITHUB_SEARCH}?q=${q}&sort=updated&order=desc&per_page=${PER_PAGE}&page=${page}`

          let data: { items?: GitHubSearchRepo[]; total_count?: number }
          try {
            const res = await politeFetch(url, { headers })
            if (res.status === 403 || res.status === 429) {
              // Secondary rate limit. Back off hard and move to the next slice
              // rather than burning the remaining budget on retries.
              errors.push(`rate limited on ${topic} ${season} page ${page}`)
              await delay(60_000)
              break
            }
            if (!res.ok) {
              errors.push(`HTTP ${res.status} on ${topic} ${season} page ${page}`)
              break
            }
            data = (await res.json()) as { items?: GitHubSearchRepo[]; total_count?: number }
          } catch (err) {
            errors.push(`${topic} ${season} page ${page}: ${err instanceof Error ? err.message : String(err)}`)
            break
          } finally {
            await delay(REQUEST_INTERVAL_MS)
          }

          const repos = data.items ?? []
          if (repos.length === 0) break

          for (const repo of repos) {
            discovered++
            if (repo.archived || repo.fork) { skipped++; continue }
            if (seen.has(repo.html_url)) { skipped++; continue }

            const teamNumber = teamNumberFromRepo(repo.full_name, repo.topics ?? [])
            if (teamNumber === null) { skipped++; continue }

            seen.add(repo.html_url)
            const year = seasonFromRepo(repo.name, repo.pushed_at)
            const haystack = `${repo.name} ${repo.description ?? ''} ${(repo.topics ?? []).join(' ')}`.toLowerCase()
            const isCad = CAD_KEYWORDS.some((k) => haystack.includes(k))

            const keywords = [
              program,
              `team:${teamNumber}`,
              ...(year ? [`year:${year}`] : []),
              isCad ? 'team_cad' : 'team_code',
            ]

            candidates.push({
              sourceUrl: `https://github.com/topics/${topic}`,
              canonicalUrl: repo.html_url,
              githubUrl: repo.html_url,
              // Team repos are named things like "2024-Robot-Code", which reads
              // badly on its own, so the team number leads.
              title: `${teamNumber} ${year ?? ''} ${isCad ? 'CAD' : 'Robot Code'}`.replace(/\s+/g, ' ').trim(),
              description: repo.description ?? undefined,
              ...(repo.homepage ? { homepageUrl: repo.homepage } : {}),
              keywords,
              notes: `github_team_code: ${repo.full_name}, ${repo.stargazers_count} stars, pushed ${repo.pushed_at}`,
            })
          }

          // A short page means the slice is exhausted; do not pay for the rest.
          if (repos.length < PER_PAGE) break
        }
      }
    }

    console.log(
      `[github-team-code] ${candidates.length} team repos from ${discovered} results (${skipped} skipped, ${errors.length} errors)`,
    )
    return { candidates, stats: { discovered, skipped, errors } }
  }
}
