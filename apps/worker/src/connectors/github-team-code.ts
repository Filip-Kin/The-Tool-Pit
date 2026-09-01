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

/**
 * CAD-ish signals, matched against the repo NAME and DESCRIPTION only.
 *
 * Topics are deliberately excluded. FRC2713/hawk-shop is a manufacturing
 * kanban app that carries the `onshape` topic because it talks to Onshape, and
 * reading that topic as "this repo is CAD" filed a web app as a team's robot
 * CAD. A team that publishes CAD says so in the name or the description.
 */
const CAD_KEYWORDS = ['cad', 'onshape', 'solidworks', 'fusion360', 'inventor', 'step-files']

/**
 * Repos that belong to a team but are not its robot code or CAD.
 *
 * The attribution is right for these and the archive is still wrong: a sample
 * of 120 accepted repos was 27% scouting apps, team websites, docs sites and
 * Chairman's/Impact submissions, which is a directory of team GitHub accounts
 * rather than a robot code archive. The tools directory has already been
 * polluted once by an auto-publishing crawler with no such gate, so this one
 * drops the repo outright rather than filing it and hoping someone reviews it.
 *
 * Matched against the repo NAME and DESCRIPTION, again not topics, because a
 * robot code repo can legitimately carry a `scouting` topic for a subsystem.
 */
const NOT_ROBOT_CODE_KEYWORDS = [
  'scout',
  'website',
  '.github.io',
  'docs',
  // 'docs' does not cover this: Team2530/Documentation published as robot code
  // because "documentation" does not contain the substring "docs".
  'documentation',
  'blog',
  'chairmans',
  'impact',
  // frc5024/PitCheck is "a checklist for programming in the pit", and a
  // picklist app is scouting output. Neither says "scout" anywhere.
  'checklist',
  'picklist',
  'wiki',
]

/**
 * Topics that disqualify a repo outright, matched EXACTLY.
 *
 * Separate from NOT_ROBOT_CODE_KEYWORDS, and deliberately a different shape.
 * The name/description rule is a substring test because prose is prose. This
 * one is an exact topic match, because topics are a controlled vocabulary and
 * a substring test over them would catch `scouting-data` on a robot repo that
 * merely logs to a scouting sink.
 *
 * It exists because the two signals fail in different places. frc1678/viewer
 * -2019-iOS calls itself "Data visualization app for FRC match strategy and
 * picklist creation": nothing in the name or the blurb says scouting, and only
 * the `frc-scouting` topic gives it away. firstwiki/frc4000 is worse. It is
 * the FIRSTWiki Jekyll shard for teams 4000-4999, not a team repo at all, yet
 * the repo name reads as team 4000 and the description "FRC Teams 4000-4999"
 * corroborates it. That is the most dangerous row this connector can produce,
 * because a wrong attribution that looks plausible is one nobody reports. Its
 * `wiki` topic is the only honest signal, so the topic gate is what stops it.
 */
const DENIED_TOPICS = new Set(['frc-scouting', 'first-robotics-scouting', 'wiki', 'documentation'])

/** True if a topic disqualifies the repo. Exact match, see DENIED_TOPICS. */
export function hasDeniedTopic(topics: string[] | undefined): boolean {
  return (topics ?? []).some((t) => DENIED_TOPICS.has(t.toLowerCase()))
}

/**
 * Lowest number we will treat as a season year rather than a team number.
 *
 * GitHub use in FRC starts around here, and no team-number guard needs to
 * reach further back than the repos we actually sweep.
 */
const SEASON_YEAR_FLOOR = 2005

/**
 * A number that could be a season rather than a team.
 *
 * The ceiling is next year because teams create their season repo before the
 * season opens: in September 2026 a repo named `frc-2027` is already normal.
 */
function looksLikeSeasonYear(n: number): boolean {
  return n >= SEASON_YEAR_FLOOR && n <= new Date().getUTCFullYear() + 1
}

/** True if the repo's own name or blurb says it is not robot code or CAD. */
export function isNotRobotCode(name: string, description: string | null | undefined): boolean {
  const hay = `${name} ${description ?? ''}`.toLowerCase()
  return NOT_ROBOT_CODE_KEYWORDS.some((k) => hay.includes(k))
}

/** True if the repo's own name or blurb says it is CAD rather than code. */
export function looksLikeCad(name: string, description: string | null | undefined): boolean {
  const hay = `${name} ${description ?? ''}`.toLowerCase()
  return CAD_KEYWORDS.some((k) => hay.includes(k))
}

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
 *
 * That rule used to be a comment and nothing more, which cost us. The patterns
 * below match a season written in the team's own naming convention just as
 * happily as a team number, so `chopshop-166/frc-2025` read as team 2025, the
 * topic `frc-2026` on FRC10479PowerHouse/shooting-sim read as team 2026, and
 * because topics were checked first, `frc-2025` on Team846/pongo overrode the
 * correct org. On a live sample that was 20% of accepted repos, and a full
 * sweep would have made phantom teams 2019, 2023, 2025 and 2026 the largest
 * entries in the archive, each holding a pile of other teams' code.
 *
 * So every pattern now contributes a CANDIDATE and a year-shaped candidate is
 * only accepted from the ORG name. An org is a team's stable identity, so
 * `frc2019/robot-code` really is team 2019, while a repo name or an `frc-YYYY`
 * topic is how everyone writes a season and can never be trusted for it.
 *
 * This does lose the occasional real team numbered in the 2005..next-year
 * range when the org does not name it. That is the correct side to err on: a
 * missing row is invisible, a row credited to the wrong team is a lie on a
 * public page, and everything this connector emits is auto-published.
 */
export function teamNumberFromRepo(fullName: string, topics: string[]): number | null {
  // Provenance travels with each candidate because it decides whether a
  // year-shaped number is admissible, so a bare list of numbers is not enough.
  const candidates: Array<{ n: number; fromOrg: boolean }> = []

  for (const t of topics.map((x) => x.toLowerCase())) {
    const m = t.match(/^(?:frc|ftc)-(\d{1,5})$/)
    if (m) candidates.push({ n: parseInt(m[1]!, 10), fromOrg: false })
  }

  const [orgPart = '', repoPart = ''] = fullName.split('/')
  // frc1678, team1678, frc-team-1678, ftcteam1234
  for (const [part, fromOrg] of [[orgPart, true], [repoPart, false]] as const) {
    const m = part.match(/^(?:frc|ftc)[-_]?(?:team[-_]?)?(\d{1,5})$/i) ?? part.match(/^team[-_]?(\d{1,5})$/i)
    if (m) candidates.push({ n: parseInt(m[1]!, 10), fromOrg })
  }

  const valid = candidates.filter((c) => c.n > 0 && c.n < 100000)
  // A real team number beats a year-shaped one wherever it appears, which is
  // what rescues team-3482/Rebuilt2026-Kleio from its own `frc-2026` topic.
  const unambiguous = valid.find((c) => !looksLikeSeasonYear(c.n))
  if (unambiguous) return unambiguous.n
  const orgYear = valid.find((c) => c.fromOrg)
  return orgYear ? orgYear.n : null
}


/**
 * The season this repo is for.
 *
 * Prefers a year written into the repo name, because that is the team saying
 * so, then a year in the description, then the year of the last push.
 *
 * The description step is not decoration. The push-date fallback is wrong in a
 * specific and damaging direction: a season repo touched after its season ends
 * gets dated to the current year, so Team846/pongo ("846's Robot Codebase for
 * 2025") and Team5427/Reefscape ("FRC 2025") both filed as 2026. On a sample
 * of 78 accepted repos, 6 of the 39 that name a year in the description had
 * the wrong season, all of them a season late. The archive page sorts newest
 * season first, so those errors do not sit quietly in the middle of the list,
 * they crowd the top of it with last year's robots.
 *
 * A two-year range needs no special case. An FTC season spans two calendar
 * years and is named by the one it STARTS in, which is how teams write it and
 * how people talk about it: INTO THE DEEP is the 2024 season, so
 * `IntoTheDeep 2024-2025` and `DECODE (2025-26)` want 2024 and 2025. The plain
 * year match below already takes the first year it finds, so it lands on the
 * right one without a range parser. An earlier version had a whole
 * seasonFromRange branch to reach the LATER year; that was the wrong
 * convention and the branch went with it.
 *
 * This does disagree with the `events` table, where TOA's seasonKeyToYear
 * stores the same season under its spring competition year: the 2025-26 FTC
 * season is year 2026 there and 2025 here. Two sources, two conventions. This
 * one follows what a team writes on its own repo. If the UI ever shows both
 * side by side, decide which wins rather than quietly changing one.
 */
export function seasonFromRepo(
  name: string,
  pushedAt: string,
  description?: string | null,
): number | null {
  // Lookarounds, not \b. A word boundary needs a non-word character beside the
  // year, so `\b2025\b` does not match "2025Reefscape" or "R2025", and both
  // silently fell through to the last-push year: Team2537/2025Reefscape and
  // Team334/R2025 were both filed as 2026 because that is when they were last
  // touched. Digit lookarounds match the year wherever the team glued it.
  const inName = name.match(/(?<![0-9])(20[0-9]{2})(?![0-9])/)
  if (inName) {
    const y = parseInt(inName[1]!, 10)
    if (y >= 2000 && y <= 2100) return y
  }
  const inDescription = (description ?? '').match(/(?<![0-9])(20[0-9]{2})(?![0-9])/)
  if (inDescription) {
    const y = parseInt(inDescription[1]!, 10)
    // Bounded by the sweep floor, not by 2000: a description mentioning a
    // sponsor's founding year is not a season, and the repo has to have been
    // pushed inside our window to be here at all.
    if (y >= FIRST_SEASON && y <= new Date().getUTCFullYear() + 1) return y
  }
  const pushed = new Date(pushedAt)
  if (!Number.isNaN(pushed.getTime())) {
    const y = pushed.getUTCFullYear()
    // No kickoff adjustment. An FTC season is named by the year it starts in,
    // and a repo pushed during that season was already pushed in that year, so
    // the push year is the answer for both programs.
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

            // Right team, wrong shelf. A team's scouting app or website is not
            // robot code, and this archive is the Robot Code / CAD archive, so
            // it is dropped here rather than published and left for a human.
            if (isNotRobotCode(repo.name, repo.description) || hasDeniedTopic(repo.topics)) { skipped++; continue }

            seen.add(repo.html_url)
            const year = seasonFromRepo(repo.name, repo.pushed_at, repo.description)
            const isCad = looksLikeCad(repo.name, repo.description)

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
