/**
 * An organisation can refuse our token on a repo anyone can read.
 *
 * FIRSTinMI and the-orange-alliance both do: "the organization forbids access
 * via a fine-grained personal access token if the token's lifetime is greater
 * than 366 days". The daily popularity pass logged five HTTP 403s and left FTA
 * Buddy at 0 stars against a live 9, and the four Orange Alliance listings the
 * same way, for weeks. Nothing about those repos changed. The token did.
 *
 * So a 403 that is not a rate limit is retried once with no Authorization
 * header at all, which is what a signed-out visitor sends.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { fetchGitHubRepoOutcome } from '../src/connectors/github.js'

const realFetch = globalThis.fetch

interface Call {
  url: string
  authorization: string | null
}

/** Record every request and answer them in order. */
function stubFetch(responses: Response[]): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({ url: String(url), authorization: headers.get('authorization') })
    const next = responses.shift()
    if (!next) throw new Error('unexpected extra request')
    return next
  }) as typeof fetch

  return calls
}

function repoBody(stars: number): string {
  return JSON.stringify({
    full_name: 'FIRSTinMI/FTA-Buddy',
    description: null,
    homepage: null,
    stargazers_count: stars,
    forks_count: 0,
    open_issues_count: 0,
    pushed_at: '2026-09-01T17:14:40Z',
    created_at: '2024-01-01T00:00:00Z',
    archived: false,
    topics: [],
    default_branch: 'main',
    language: 'TypeScript',
  })
}

/** The real 403: budget untouched, the refusal is about the token's lifetime. */
function orgBlocked(): Response {
  return new Response(
    JSON.stringify({ message: "The 'FIRSTinMI' organization forbids access via a fine-grained personal access tokens" }),
    { status: 403, headers: { 'x-ratelimit-remaining': '4356' } },
  )
}

describe('a repo whose org blocks our token', () => {
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.GITHUB_TOKEN
  })

  it('is read anonymously rather than left at zero', async () => {
    process.env.GITHUB_TOKEN = 'github_pat_test'
    const calls = stubFetch([orgBlocked(), new Response(repoBody(9), { status: 200 })])

    const outcome = await fetchGitHubRepoOutcome('https://github.com/FIRSTinMI/FTA-Buddy')

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.repo.stars).toBe(9)

    // The retry is the same URL with the Authorization header dropped.
    expect(calls).toHaveLength(2)
    expect(calls[0].authorization).toBe('Bearer github_pat_test')
    expect(calls[1].authorization).toBeNull()
    expect(calls[1].url).toBe(calls[0].url)
  })

  it('reports no rate-limit budget for the anonymous answer', async () => {
    // The trap this exists to catch. Anonymous GitHub is 60 requests an hour,
    // and the popularity sweep stops the entire pass when the remaining budget
    // drops to 100. Passing the anonymous headers straight through would end
    // the pass at the first org-blocked repo and leave 600 listings unread,
    // which is far worse than the one zero it set out to fix.
    process.env.GITHUB_TOKEN = 'github_pat_test'
    stubFetch([
      orgBlocked(),
      new Response(repoBody(9), { status: 200, headers: { 'x-ratelimit-remaining': '57' } }),
    ])

    const outcome = await fetchGitHubRepoOutcome('https://github.com/FIRSTinMI/FTA-Buddy')

    expect(outcome.kind).toBe('ok')
    if (outcome.kind !== 'ok') return
    expect(outcome.rateLimitRemaining).toBeNull()
  })

  it('still stops the pass when the 403 is a spent budget', async () => {
    // Same status, opposite meaning. Retrying anonymously here would walk into
    // the next 600 failures instead of stopping, which is how a token gets
    // restricted rather than merely limited.
    process.env.GITHUB_TOKEN = 'github_pat_test'
    const calls = stubFetch([
      new Response('{}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1900000000' },
      }),
    ])

    const outcome = await fetchGitHubRepoOutcome('https://github.com/FIRSTinMI/FTA-Buddy')

    expect(outcome.kind).toBe('rate-limited')
    expect(calls).toHaveLength(1)
  })

  it('does not retry a repo that is actually gone', async () => {
    process.env.GITHUB_TOKEN = 'github_pat_test'
    const calls = stubFetch([new Response('{}', { status: 404 })])

    const outcome = await fetchGitHubRepoOutcome('https://github.com/frc2468/reefscape-alpha-2025')

    expect(outcome.kind).toBe('gone')
    expect(calls).toHaveLength(1)
  })
})
