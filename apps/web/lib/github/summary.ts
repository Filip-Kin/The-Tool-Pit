/**
 * What a link or a re-check produced, as it crosses the wire.
 *
 * Kept apart from grant.ts because the browser needs this shape and grant.ts
 * pulls in the database. Nothing here imports anything.
 */

/** One listing the link handed over, named so the user can see what they got. */
export interface GrantedListing {
  entityId: string
  title: string
  href: string
}

export interface GithubGrantSummary {
  login: string
  /** Listings this run granted. Empty is a normal outcome, not a failure. */
  granted: GrantedListing[]
  /** Matched, but somebody else owns them, so an admin was asked instead. */
  disputed: GrantedListing[]
  /** Matched and already yours. Only ever non-zero on a re-check. */
  alreadyYours: number
  /** False when the token had no read:org, so private memberships were invisible. */
  sawPrivateOrgs: boolean
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`
}

/**
 * The headline sentence after a link or a re-check.
 *
 * Zero is said plainly. A user whose repositories are not in the directory has
 * not failed at anything and must not be shown a sentence that reads like they
 * have, so the no-match wording explains what happened and what would change it.
 */
export function describeGithubGrant(summary: GithubGrantSummary): string {
  const parts: string[] = []

  if (summary.granted.length > 0) {
    parts.push(`You now manage ${plural(summary.granted.length, 'listing', 'listings')}.`)
  } else if (summary.alreadyYours > 0) {
    parts.push('No new listings this time. You already manage everything we matched.')
  } else {
    parts.push(
      `Linked as ${summary.login}. Nothing here is built from a repository in your GitHub namespaces yet, so nothing changed.`,
    )
  }

  if (summary.disputed.length > 0) {
    parts.push(
      `${plural(summary.disputed.length, 'listing', 'listings')} matched but already had an owner, so an admin will look at those.`,
    )
  }

  if (!summary.sawPrivateOrgs) {
    parts.push('We could only see your public organisations. Allow the organisation permission to include private ones.')
  }

  return parts.join(' ')
}
