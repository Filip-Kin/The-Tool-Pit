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
    if (u.hostname !== 'github.com') return null
    const parts = u.pathname.replace(/^\//, '').split('/')
    if (parts.length < 2) return null
    const [owner, repo] = parts
    // Strip .git suffix
    return { owner, repo: repo.replace(/\.git$/, '') }
  } catch {
    return null
  }
}

export async function fetchGitHubRepo(url: string): Promise<GitHubRepoInfo | null> {
  const parsed = parseGitHubUrl(url)
  if (!parsed) return null

  const { owner, repo } = parsed
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`

  const token = process.env.GITHUB_TOKEN
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  try {
    const res = await politeFetch(apiUrl, { headers })
    if (res.status === 404) return null
    if (!res.ok) {
      console.warn(`[github] HTTP ${res.status} for ${apiUrl}`)
      return null
    }

    const data = await res.json() as Record<string, unknown>

    return {
      fullName: data.full_name as string,
      description: (data.description as string | null) ?? null,
      homepage: (data.homepage as string | null) ?? null,
      stars: (data.stargazers_count as number) ?? 0,
      forks: (data.forks_count as number) ?? 0,
      openIssues: (data.open_issues_count as number) ?? 0,
      pushedAt: (data.pushed_at as string | null) ?? null,
      createdAt: data.created_at as string,
      archived: (data.archived as boolean) ?? false,
      topics: (data.topics as string[]) ?? [],
      defaultBranch: (data.default_branch as string) ?? 'main',
      language: (data.language as string | null) ?? null,
    }
  } catch (err) {
    console.error(`[github] error fetching ${apiUrl}:`, err)
    return null
  }
}
