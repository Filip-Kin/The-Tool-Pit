import { buildNamespaceSet } from './namespaces'

/**
 * Reading a GitHub identity from an OAuth access token.
 *
 * Two calls, both read-only, both made once and then forgotten:
 *   GET /user       - who the token belongs to (login and numeric id)
 *   GET /user/orgs  - every organisation they are a member of, PUBLIC OR NOT
 *
 * The second one is the whole reason the link asks for read:org. Most FRC teams
 * keep their org membership private, and a scope that only saw public members
 * would grant nothing to the people it is meant for.
 *
 * We ask for read:user and read:org and nothing else. `repo` would let us read
 * the permissions field on each repository, but GitHub shows that scope to the
 * user as full control of their repositories, and people decline it, so the
 * feature would not exist for the people who need it. Membership of the
 * namespace is the proof instead. Note that `permissions.pull` would have been
 * no proof at all: it is true for every authenticated user on every public
 * repository on GitHub.
 *
 * THE TOKEN NEVER LEAVES THIS FILE'S ARGUMENTS. It goes in an Authorization
 * header and nowhere else. Nothing here logs it, no error message carries it,
 * and it is never written to the database. Errors thrown from here are fixed
 * strings we wrote, never a pass-through of a response body, because a
 * pass-through is how a credential ends up in a log line.
 */

const API = 'https://api.github.com'
const ACCEPT = 'application/vnd.github+json'
const API_VERSION = '2022-11-28'
/** GitHub asks every client to identify itself; an anonymous one gets throttled. */
const USER_AGENT = 'the-tool-pit (frc.tools)'

/** GitHub's max page size. Nobody is in more than 1000 organisations. */
const PER_PAGE = 100
const MAX_PAGES = 10

export interface GithubIdentity {
  login: string
  /** The numeric id as a string. Never renamed, never reissued. */
  userId: string
  /** Every org login, in GitHub's own casing, for display. */
  orgs: string[]
  /** Login plus orgs, lowercased. What the matcher compares against. */
  namespaces: ReadonlySet<string>
  /**
   * False when the token came back without read:org. GitHub does not fail the
   * call in that case, it just quietly returns public memberships only, so the
   * user would see a short list and no reason for it. The UI says so instead.
   */
  sawPrivateOrgs: boolean
}

/** Thrown for anything the user can act on. The message is safe to show them. */
export class GithubLinkError extends Error {}

interface GithubUserResponse {
  login?: unknown
  id?: unknown
}

interface GithubOrgResponse {
  login?: unknown
}

async function call(path: string, accessToken: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: ACCEPT,
        'x-github-api-version': API_VERSION,
        'user-agent': USER_AGENT,
      },
      cache: 'no-store',
    })
  } catch {
    // Deliberately swallowing the cause. A fetch error can carry the request,
    // and the request carries the Authorization header.
    throw new GithubLinkError('We could not reach GitHub. Try again in a moment.')
  }

  if (res.status === 401 || res.status === 403) {
    throw new GithubLinkError('GitHub would not accept that sign-in. Try linking again.')
  }
  if (res.status === 429) {
    throw new GithubLinkError('GitHub is rate limiting us right now. Try again in a few minutes.')
  }
  if (!res.ok) {
    throw new GithubLinkError(`GitHub returned an error (${res.status}). Try again in a moment.`)
  }
  return res
}

/**
 * The account behind the token, and every namespace it may claim from.
 *
 * Called once per link or re-check, then the token is dropped by the caller.
 */
export async function readGithubIdentity(accessToken: string): Promise<GithubIdentity> {
  const userRes = await call('/user', accessToken)

  // GitHub reports the scopes the token actually carries on every response. A
  // user who edited the consent screen, or an old token minted before we asked
  // for read:org, lands here with a short list rather than an error.
  const grantedScopes = (userRes.headers.get('x-oauth-scopes') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const sawPrivateOrgs = grantedScopes.includes('read:org') || grantedScopes.includes('admin:org')

  const user = (await userRes.json()) as GithubUserResponse
  const login = typeof user.login === 'string' ? user.login : ''
  const userId =
    typeof user.id === 'number' ? String(user.id) : typeof user.id === 'string' ? user.id : ''
  if (!login || !userId) {
    throw new GithubLinkError('GitHub did not tell us who you are. Try linking again.')
  }

  const orgs: string[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await call(`/user/orgs?per_page=${PER_PAGE}&page=${page}`, accessToken)
    const body: unknown = await res.json()
    if (!Array.isArray(body)) break
    for (const entry of body as GithubOrgResponse[]) {
      if (typeof entry.login === 'string' && entry.login) orgs.push(entry.login)
    }
    // A short page is the last page. Cheaper and less brittle than parsing Link.
    if (body.length < PER_PAGE) break
  }

  return { login, userId, orgs, namespaces: buildNamespaceSet(login, orgs), sawPrivateOrgs }
}
