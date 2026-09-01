import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  listingClaims,
  listingOwners,
  toolLinks,
  tools,
  users,
  type ClaimEvidence,
  type User,
} from '@the-tool-pit/db'
import { listingFacts, type ListingFacts } from '@/lib/queries/listing-ownership'
import { sendApprovalNotice, reviewClaimUrl } from '@the-tool-pit/types'
import { GithubLinkError, type GithubIdentity } from './identity'
import { matchNamespace, planGithubGrants, type RepoLink } from './namespaces'

/**
 * Turning a verified GitHub identity into listing ownership.
 *
 * The rule at the top of packages/db/src/schema/listing-ownership.ts is the one
 * this file exists to keep. The listing_owners row is written ONLY after the
 * GitHub check has already passed, and a listing_claims row goes in beside it as
 * the audit trail, so a dispute months later can be read without re-running a
 * check that is no longer runnable: the OAuth token is gone by then.
 *
 * A listing somebody else already owns is never taken. It becomes a pending
 * claim for an admin, exactly as a repo_file proof landing on an owned listing
 * does in app/me/listings/actions.ts. One convention, two proofs.
 *
 * Safe to run again and again, which is what the re-check button leans on:
 * listings the user already holds produce no writes at all.
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

/**
 * Write the GitHub identity onto the user row.
 *
 * The unique index on github_user_id is the real guard, and this is the
 * readable error in front of it: two TTP accounts must never hold the same
 * GitHub identity, or the same repositories would earn ownership twice and the
 * audit trail would stop meaning anything.
 */
export async function linkGithubIdentity(user: User, identity: GithubIdentity): Promise<void> {
  const db = getDb()

  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.githubUserId, identity.userId), ne(users.id, user.id)))
    .limit(1)
  if (taken) {
    throw new GithubLinkError(
      'That GitHub account is already linked to another account here. Sign in with that one, or unlink it first.',
    )
  }

  await db
    .update(users)
    .set({
      githubLogin: identity.login,
      githubUserId: identity.userId,
      githubLinkedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
}

/**
 * Every GitHub link on a published tool listing.
 *
 * Pulled whole rather than filtered by namespace in SQL. It is a couple of
 * thousand rows, and doing the matching in one tested function beats writing a
 * second, subtly different matcher in LIKE patterns that would have to get the
 * www and the trailing slash and the case folding right all over again.
 *
 * Published only. A draft is below the confidence threshold and a suppressed
 * row is spam or a duplicate; quietly handing somebody a pile of those on link
 * would be noise, not a feature. They can still claim one by hand.
 */
async function repoLinksOnPublishedTools(): Promise<RepoLink[]> {
  const db = getDb()
  const rows = await db
    .select({ entityId: toolLinks.toolId, url: toolLinks.url })
    .from(toolLinks)
    .innerJoin(tools, eq(tools.id, toolLinks.toolId))
    .where(and(eq(tools.status, 'published'), sql`${toolLinks.url} ILIKE '%github.com/%'`))
  return rows
}

/**
 * Match the user's namespaces against every repo-backed listing, then grant.
 *
 * Call it after linkGithubIdentity, and call it again whenever the user asks
 * for a re-check: listings published since they linked get picked up, and
 * everything already settled is left alone.
 */
export async function applyGithubGrants(
  user: User,
  identity: GithubIdentity,
): Promise<GithubGrantSummary> {
  const db = getDb()

  const allLinks = await repoLinksOnPublishedTools()
  const matchedLinks = allLinks.filter((l) => matchNamespace(identity.namespaces, l.url) !== null)

  const summary: GithubGrantSummary = {
    login: identity.login,
    granted: [],
    disputed: [],
    alreadyYours: 0,
    sawPrivateOrgs: identity.sawPrivateOrgs,
  }
  if (matchedLinks.length === 0) return summary

  // Ownership is read only for the listings that matched, so the IN list stays
  // the size of one person's repositories rather than the whole table.
  const matchedIds = [...new Set(matchedLinks.map((l) => l.entityId))]
  const ownerRows = await db
    .select({ entityId: listingOwners.entityId, userId: listingOwners.userId })
    .from(listingOwners)
    .where(and(eq(listingOwners.entityType, 'tool'), inArray(listingOwners.entityId, matchedIds)))

  const yours = new Set(ownerRows.filter((r) => r.userId === user.id).map((r) => r.entityId))
  const anyone = new Set(ownerRows.map((r) => r.entityId))

  const plan = planGithubGrants(matchedLinks, identity.namespaces, { yours, anyone })

  // A pending claim this user already filed on a matched listing. Without this
  // a second re-check would stack a duplicate dispute in the admin queue for
  // something an admin has not got to yet.
  const openClaimIds = new Set(
    (
      await db
        .select({ entityId: listingClaims.entityId })
        .from(listingClaims)
        .where(
          and(
            eq(listingClaims.userId, user.id),
            eq(listingClaims.entityType, 'tool'),
            eq(listingClaims.status, 'pending'),
            inArray(listingClaims.entityId, matchedIds),
          ),
        )
    ).map((r) => r.entityId),
  )

  for (const match of plan) {
    if (match.outcome === 'held') {
      summary.alreadyYours++
      continue
    }

    const facts = await listingFacts('tool', match.entityId)
    if (!facts) continue

    const evidence: ClaimEvidence = {
      repoUrl: match.url,
      githubLogin: identity.login,
      githubNamespace: match.namespace,
    }

    if (match.outcome === 'grant') {
      // Order matters: the check has passed, so the trusted row goes in first
      // and the claim beside it records why. onConflictDoNothing covers the
      // race where two tabs link at once.
      await db
        .insert(listingOwners)
        .values({
          entityType: 'tool',
          entityId: match.entityId,
          userId: user.id,
          role: 'owner',
          verifiedVia: 'github_account',
          invitedBy: null,
        })
        .onConflictDoNothing()
      await db.insert(listingClaims).values({
        entityType: 'tool',
        entityId: match.entityId,
        userId: user.id,
        method: 'github_account',
        status: 'verified',
        evidence,
        decidedByUserId: user.id,
        decidedAt: new Date(),
      })
      summary.granted.push({ entityId: match.entityId, title: facts.title, href: facts.href })
      continue
    }

    // outcome === 'dispute'. Somebody else set this listing up. Real proof
    // against an owned listing is the sharpest thing the claims queue gets, so
    // it is filed and a person is told, and nothing is taken.
    summary.disputed.push({ entityId: match.entityId, title: facts.title, href: facts.href })
    if (openClaimIds.has(match.entityId)) continue

    const [filed] = await db
      .insert(listingClaims)
      .values({
        entityType: 'tool',
        entityId: match.entityId,
        userId: user.id,
        method: 'github_account',
        status: 'pending',
        evidence,
        reviewerNote: 'GitHub namespace matched but the listing was already owned. Held for review.',
      })
      .returning({ id: listingClaims.id })

    sendApprovalNotice({
      vertical: 'claim',
      title: `Tool · GitHub namespace match on an owned listing`,
      reviewUrl: reviewClaimUrl(filed.id),
      submitter: user.displayName ?? user.email ?? null,
      facts: [
        { label: 'Contested', value: 'Yes, and the claimant is inside the namespace that owns the repo' },
        { label: 'GitHub account', value: identity.login },
        { label: 'Namespace', value: match.namespace },
        { label: 'Repo', value: match.url },
      ],
    })
  }

  return summary
}

export type { ListingFacts }
