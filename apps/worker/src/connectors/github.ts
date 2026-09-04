/**
 * GitHub connector.
 * Given a GitHub repo URL, fetches repo metadata via the GitHub API.
 * Used during enrichment to get stars, last push date, archived status, etc.
 */
import { politeFetch } from './base.js'

export interface GitHubRepoInfo {
  fullName: string
  description: string | null
  homepage: string | null
  stars: number
  forks: number
  openIssues: number
  pushedAt: string | null
  createdAt: string
  archived: boolean
  topics: string[]
  defaultBranch: string
  language: string | null
}

/** Parse a GitHub URL into owner/repo. Returns null if not a valid GitHub repo URL. */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url)
    // www.github.com is github.com. The popularity pass skipped a real listing
    // over the prefix alone, and it is the kind of URL a person pastes.
    if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null
    const parts = u.pathname.replace(/^\//, '').split('/')
    if (parts.length < 2) return null
    const [owner, repo] = parts
    // Strip .git suffix
    return { owner, repo: repo.replace(/\.git$/, '') }
  } catch {
    return null
  }
}

/**
 * One GitHub API request, retried anonymously when an organisation refuses our
 * token.
 *
 * FIRSTinMI and the-orange-alliance both answer 403 to the deploy token: "the
 * organization forbids access via a fine-grained personal access token if the
 * token's lifetime is greater than 366 days". That is a policy about the token,
 * not about the repo. All five repos are public and any signed-out visitor can
 * read them, so the popularity pass was holding FTA Buddy and four TOA listings
 * at zero stars over an org setting we do not control.
 *
 * Retried once, only on a 403 that is not a rate limit, and only when a token
 * was actually sent. Anonymous requests get 60 an hour against 5000, so this is
 * the fallback for the handful of repos an org blocks and never the default.
 *
 * The caller is told which request answered, because the two budgets must not
 * be confused. The anonymous limit is always below the sweep's floor of 100, so
 * reporting it as the token's remaining budget would stop the whole pass on the
 * first blocked repo.
 */
async function githubApiFetch(
  url: string,
  accept: string,
): Promise<{ res: Response; anonymous: boolean }> {
  const token = process.env.GITHUB_TOKEN
  const headers: Record<string, string> = { Accept: accept }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await politeFetch(url, { headers })
  if (!token || res.status !== 403 || isRateLimited(res.status, res.headers)) {
    return { res, anonymous: false }
  }

  return { res: await politeFetch(url, { headers: { Accept: accept } }), anonymous: true }
}

/**
 * Fetch a repo's README as raw text, in whatever markup it is written in.
 *
 * raw.githubusercontent.com is a CDN and is not metered against the API rate limit, so the
 * one spelling that covers most repos is tried there first. The API's /readme endpoint
 * finds every other spelling (README.adoc, README.rst, lowercase, a docs/ subdirectory) in
 * a single call, which is worth one unit of rate limit for the repos the CDN misses.
 */
export async function fetchGitHubReadme(owner: string, repo: string): Promise<string | null> {
  const cap = 20_000

  try {
    const res = await politeFetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`)
    if (res.ok) return (await res.text()).slice(0, cap)
  } catch {
    // Fall through to the API, which answers for every other spelling anyway.
  }

  try {
    const { res } = await githubApiFetch(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      'application/vnd.github.raw',
    )
    if (!res.ok) return null
    return (await res.text()).slice(0, cap)
  } catch (err) {
    console.error(`[github] error fetching README for ${owner}/${repo}:`, err)
    return null
  }
}

/**
 * The repo's file paths (recursive), for classifying WHAT a repo is by its
 * shape rather than its blurb: an FRC robot project has src/main/java/frc/robot,
 * a .wpilib folder and vendordeps, and no description has to say so. Best-effort
 * and capped: returns [] on any error or rate limit, so a caller treats "no
 * signal" and "could not look" the same, which is the safe direction.
 */
export async function fetchGitHubTree(owner: string, repo: string, branch: string): Promise<string[]> {
  try {
    const { res } = await githubApiFetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      'application/vnd.github.v3+json',
    )
    if (!res.ok) return []
    const data = (await res.json()) as { tree?: Array<{ path?: string; type?: string }> }
    return (data.tree ?? [])
      .map((n) => n.path)
      .filter((p): p is string => typeof p === 'string')
      .slice(0, 4000)
  } catch (err) {
    console.error(`[github] error fetching tree for ${owner}/${repo}:`, err)
    return []
  }
}

// #region outcomes
//
// A sweep needs to tell four things apart that fetchGitHubRepo collapses into
// one null: the repo answered, the repo is gone, GitHub is refusing us for the
// rest of the hour, and something else broke. They call for opposite actions.
// A 404 must leave the last known star count alone, because zeroing a listing's
// score for a deleted repo is a silent demotion nobody asked for. A rate limit
// must stop the whole pass, because the next 400 requests will fail the same
// way and hammering a limit is how the token gets restricted.

export type GitHubFetchOutcome =
  | { kind: 'ok'; repo: GitHubRepoInfo; rateLimitRemaining: number | null }
  /** 404. The repo was deleted, renamed or made private. */
  | { kind: 'gone' }
  /** Primary or secondary rate limit. resetAt is when it is worth trying again. */
  | { kind: 'rate-limited'; resetAt: Date | null }
  | { kind: 'error'; status: number | null; message: string }

/** Header parsing, split out because it is the part worth a test. */
export function readRateLimit(headers: Headers): { remaining: number | null; resetAt: Date | null } {
  const rawRemaining = headers.get('x-ratelimit-remaining')
  const remaining = rawRemaining === null || rawRemaining === '' ? null : Number(rawRemaining)

  // Two spellings. The primary limit carries an epoch-seconds reset; a
  // secondary limit carries Retry-After in seconds and no reset at all.
  const rawReset = headers.get('x-ratelimit-reset')
  const retryAfter = headers.get('retry-after')
  let resetAt: Date | null = null
  if (rawReset && Number.isFinite(Number(rawReset))) {
    resetAt = new Date(Number(rawReset) * 1000)
  } else if (retryAfter && Number.isFinite(Number(retryAfter))) {
    resetAt = new Date(Date.now() + Number(retryAfter) * 1000)
  }

  return { remaining: Number.isFinite(remaining) ? remaining : null, resetAt }
}

/**
 * Whether a response is GitHub saying "not now" rather than "no".
 *
 * GitHub answers a spent budget with 403, which is the same status it uses for
 * a private repo, so the status alone is not enough. The distinguishing header
 * is x-ratelimit-remaining: 0. 429 is the secondary limit and needs no header.
 */
export function isRateLimited(status: number, headers: Headers): boolean {
  if (status === 429) return true
  if (status !== 403) return false
  const { remaining } = readRateLimit(headers)
  return remaining === 0
}

export async function fetchGitHubRepoOutcome(url: string): Promise<GitHubFetchOutcome> {
  const parsed = parseGitHubUrl(url)
  if (!parsed) return { kind: 'error', status: null, message: `not a GitHub repo URL: ${url}` }

  const { owner, repo } = parsed
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`

  try {
    const { res, anonymous } = await githubApiFetch(apiUrl, 'application/vnd.github.v3+json')
    if (res.status === 404) return { kind: 'gone' }
    if (isRateLimited(res.status, res.headers)) {
      return { kind: 'rate-limited', resetAt: readRateLimit(res.headers).resetAt }
    }
    if (!res.ok) {
      return { kind: 'error', status: res.status, message: `HTTP ${res.status} for ${apiUrl}` }
    }

    const data = await res.json() as Record<string, unknown>

    return {
      kind: 'ok',
      // Null for an answer that came back anonymously: 60-an-hour is not the
      // token's budget and must not be read as the sweep running out of room.
      rateLimitRemaining: anonymous ? null : readRateLimit(res.headers).remaining,
      repo: {
        fullName: data.full_name as string,
        description: (data.description as string | null) ?? null,
        homepage: (data.homepage as string | null) ?? null,
        // stargazers_count on a fork is the FORK's own count, not the parent's,
        // which is what we want: we suppress forks, and a fork that somehow
        // reaches the catalogue should be ranked on the interest it earned.
        stars: (data.stargazers_count as number) ?? 0,
        forks: (data.forks_count as number) ?? 0,
        openIssues: (data.open_issues_count as number) ?? 0,
        pushedAt: (data.pushed_at as string | null) ?? null,
        createdAt: data.created_at as string,
        archived: (data.archived as boolean) ?? false,
        topics: (data.topics as string[]) ?? [],
        defaultBranch: (data.default_branch as string) ?? 'main',
        language: (data.language as string | null) ?? null,
      },
    }
  } catch (err) {
    return { kind: 'error', status: null, message: String(err) }
  }
}

// #endregion

/**
 * The old shape, kept because enrichment and the freshness pass only ever ask
 * "did it answer". One HTTP path underneath, so the two cannot drift.
 */
export async function fetchGitHubRepo(url: string): Promise<GitHubRepoInfo | null> {
  const outcome = await fetchGitHubRepoOutcome(url)
  if (outcome.kind === 'ok') return outcome.repo
  if (outcome.kind === 'error') console.error(`[github] ${outcome.message}`)
  if (outcome.kind === 'rate-limited') console.warn('[github] rate limited')
  return null
}
