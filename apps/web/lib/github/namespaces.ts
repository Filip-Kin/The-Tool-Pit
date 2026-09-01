/**
 * Matching a listing's repository against the namespaces a GitHub account
 * belongs to.
 *
 * The rule from listing-ownership.ts still holds: a claim is not proof. What
 * makes this proof is where the namespace set comes from. GitHub told us, over
 * the user's own OAuth token, which login they are and which organisations they
 * belong to. The browser never asserts any of it and nothing in this file talks
 * to the network, so the set is a fact by the time it gets here.
 *
 * Everything here is pure. The API calls live in ./identity.ts and the database
 * writes in ../../app/me/listings/github-actions.ts, so the part that decides
 * who gets a listing can be tested without either.
 */

/**
 * Path segments GitHub keeps for itself. None of them is a user or an
 * organisation, so a URL starting with one is never a repo in somebody's
 * namespace. `orgs` is the one that matters in practice: github.com/orgs/frc206
 * is a real page about a real org, and reading "orgs" as the owner of a repo
 * called "frc206" would be nonsense.
 */
const RESERVED_SEGMENTS = new Set([
  'about',
  'apps',
  'codespaces',
  'collections',
  'contact',
  'enterprise',
  'events',
  'explore',
  'features',
  'issues',
  'join',
  'login',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'pricing',
  'pulls',
  'readme',
  'search',
  'security',
  'settings',
  'site',
  'sponsors',
  'stars',
  'topics',
  'trending',
  'users',
])

/**
 * The owner segment of a GitHub repository URL, lowercased, or null.
 *
 * Strict on the host on purpose. The repo_file check in
 * app/me/listings/actions.ts accepts any github.com subdomain because it only
 * ever fetches a file; this one hands somebody write access to a listing, so it
 * takes github.com and www.github.com and nothing else. gist.github.com is
 * excluded by the same rule: a gist is not the repo a listing is built from.
 *
 * Requires two path segments. A bare github.com/frc206 is a profile page, not a
 * repository, and granting on it would let a listing that merely links to a
 * person's profile carry the same weight as one that links to their code.
 */
export function githubOwnerFromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  const host = parsed.hostname.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') return null

  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null

  const owner = parts[0].toLowerCase()
  const repo = parts[1].replace(/\.git$/i, '')
  if (!owner || !repo) return null
  if (RESERVED_SEGMENTS.has(owner)) return null
  return owner
}

/**
 * The set of namespaces a linked account may claim from: their own login plus
 * every organisation they belong to.
 *
 * Lowercased on the way in because GitHub logins are case-insensitive, so
 * Team254 and team254 are the same namespace and a URL can be written either
 * way. Comparison is on the whole string, never a substring: frc206 and frc2062
 * are two different teams and one must never pick up the other's listings.
 */
export function buildNamespaceSet(
  login: string,
  orgLogins: readonly string[],
): ReadonlySet<string> {
  const set = new Set<string>()
  for (const name of [login, ...orgLogins]) {
    const trimmed = name.trim().toLowerCase()
    if (trimmed) set.add(trimmed)
  }
  return set
}

/** The namespace that owns this URL, when it is one of ours. */
export function matchNamespace(
  namespaces: ReadonlySet<string>,
  url: string,
): string | null {
  const owner = githubOwnerFromUrl(url)
  if (!owner) return null
  return namespaces.has(owner) ? owner : null
}

/** One repository link on one listing. A listing may have several. */
export interface RepoLink {
  entityId: string
  url: string
}

/**
 * What we intend to do about one matched listing.
 *   grant   - nobody owns it, so the check writes the listing_owners row.
 *   dispute - somebody else already owns it. Hands off; an admin decides.
 *   held    - the user already owns it. Nothing to do, and nothing to report.
 */
export type GithubMatchOutcome = 'grant' | 'dispute' | 'held'

export interface GithubMatch {
  entityId: string
  /** The namespace segment that matched, kept on the claim for the audit trail. */
  namespace: string
  /** The link that matched, so a reviewer can see exactly what we read. */
  url: string
  outcome: GithubMatchOutcome
}

export interface OwnershipSnapshot {
  /** Listing ids this user already holds. */
  yours: ReadonlySet<string>
  /** Listing ids anybody holds, including this user. */
  anyone: ReadonlySet<string>
}

/**
 * Decide what each matched listing becomes.
 *
 * The collision rule is the whole point of the third branch: a listing that
 * already has an owner is never taken, whatever the proof says, because the
 * person holding it set it up and a second passing proof is a dispute between
 * two people, not a handover. That is how a repo_file proof landing on an owned
 * listing is handled, and this is the same rule with a different proof.
 *
 * Safe to run again and again. A listing the user already holds comes back as
 * 'held' and produces no write, which is what makes the re-check button harmless
 * to lean on.
 */
export function planGithubGrants(
  links: readonly RepoLink[],
  namespaces: ReadonlySet<string>,
  ownership: OwnershipSnapshot,
): GithubMatch[] {
  const byEntity = new Map<string, GithubMatch>()

  for (const link of links) {
    // First matching link wins. A listing with a personal repo and an org
    // mirror is still one listing, and a second row would try to grant twice.
    if (byEntity.has(link.entityId)) continue
    const namespace = matchNamespace(namespaces, link.url)
    if (!namespace) continue

    const outcome: GithubMatchOutcome = ownership.yours.has(link.entityId)
      ? 'held'
      : ownership.anyone.has(link.entityId)
        ? 'dispute'
        : 'grant'

    byEntity.set(link.entityId, { entityId: link.entityId, namespace, url: link.url, outcome })
  }

  return [...byEntity.values()]
}
