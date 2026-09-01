import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  grantMatches,
  grants,
  teamProfiles,
  teamProfileMembers,
  userTeams,
  type TeamProfile,
} from '@the-tool-pit/db'

/**
 * Team profile reads.
 *
 * PRIVACY, and this is the whole reason these helpers exist rather than each
 * page writing its own select:
 *
 *   team_profiles.ein, mailingAddress, contactName, contactEmail and
 *   contactPhone are private to the team's own members. They must never appear
 *   in a query that feeds a public page, an API response, a sitemap or a search
 *   index. Every function in this file is gated on a team_profile_members row
 *   for the signed-in user. Nothing here is exported to a client component:
 *   the page passes the loaded values down as props, so the form never learns
 *   how to read a profile it was not given.
 *
 *   If a public surface ever needs part of a team profile (a "teams in your
 *   state" list, say), it gets its OWN helper that names the safe columns one
 *   by one. Do not widen these. A select of the whole row is safe here only
 *   because the caller has already proved membership.
 *
 * Editing is a real permission, which is why teamProfileMembers exists
 * separately from accounts.userTeams. userTeams is self-asserted ("I am on
 * 3538") and only changes what that user sees. A member row changes an EIN and
 * a mailing address, so it is never created from a claim alone.
 */

/** Roles from team_profile_members.role that may write. 'viewer' may only read. */
const WRITE_ROLES = ['owner', 'editor']

export interface EditableProfile {
  profile: TeamProfile
  /** owner | editor | viewer */
  role: string
  canEdit: boolean
}

/** Every profile this user may open, in programme then team-number order. */
export async function listProfilesForUser(userId: string): Promise<EditableProfile[]> {
  const db = getDb()
  const rows = await db
    .select({ profile: teamProfiles, role: teamProfileMembers.role })
    .from(teamProfileMembers)
    .innerJoin(teamProfiles, eq(teamProfiles.id, teamProfileMembers.profileId))
    .where(eq(teamProfileMembers.userId, userId))
    .orderBy(asc(teamProfiles.program), asc(teamProfiles.teamNumber))

  return rows.map((r) => ({
    profile: r.profile,
    role: r.role,
    canEdit: WRITE_ROLES.includes(r.role),
  }))
}

/**
 * One profile, only if this user is a member of it. Returns null for both "no
 * such profile" and "not your profile" on purpose: telling the two apart would
 * confirm that a given team has a profile to anyone who can guess a UUID.
 */
export async function getProfileForUser(userId: string, profileId: string): Promise<EditableProfile | null> {
  const db = getDb()
  const [row] = await db
    .select({ profile: teamProfiles, role: teamProfileMembers.role })
    .from(teamProfileMembers)
    .innerJoin(teamProfiles, eq(teamProfiles.id, teamProfileMembers.profileId))
    .where(and(eq(teamProfileMembers.userId, userId), eq(teamProfileMembers.profileId, profileId)))
    .limit(1)

  if (!row) return null
  return { profile: row.profile, role: row.role, canEdit: WRITE_ROLES.includes(row.role) }
}

/** True when this user may write to this profile. Used by the server actions. */
export async function canEditProfile(userId: string, profileId: string): Promise<boolean> {
  const db = getDb()
  const [row] = await db
    .select({ role: teamProfileMembers.role })
    .from(teamProfileMembers)
    .where(and(eq(teamProfileMembers.userId, userId), eq(teamProfileMembers.profileId, profileId)))
    .limit(1)
  return !!row && WRITE_ROLES.includes(row.role)
}

// #region starting a profile

/** A team the user has claimed on /me/team, and whether it can be set up here. */
export interface ClaimableTeam {
  program: string
  teamNumber: number
  /**
   * A profile already exists for this team and the user is NOT a member of it.
   * We do not auto-join them: someone else on the team entered an EIN and a
   * contact address, and a self-asserted team number is not enough to read it.
   */
  takenByOthers: boolean
}

/**
 * The claimed teams that do not yet have a profile this user can open.
 *
 * Deliberately driven off userTeams rather than letting anyone type any number
 * into a "create profile" box. Claiming is free, but it is at least a
 * deliberate act recorded against the account.
 */
export async function listClaimableTeams(userId: string): Promise<ClaimableTeam[]> {
  const db = getDb()

  const claimed = await db
    .select({ program: userTeams.program, teamNumber: userTeams.teamNumber })
    .from(userTeams)
    .where(eq(userTeams.userId, userId))
    .orderBy(asc(userTeams.program), asc(userTeams.teamNumber))
  if (claimed.length === 0) return []

  const mine = await listProfilesForUser(userId)
  const mineKeys = new Set(mine.map((m) => `${m.profile.program}:${m.profile.teamNumber}`))

  // One query for the whole claimed set. `teamNumber` alone can collide across
  // programmes (FRC 1 and FTC 1 are different teams), so the pair is rebuilt in
  // JS rather than trusting a number match.
  const existing = await db
    .select({ program: teamProfiles.program, teamNumber: teamProfiles.teamNumber })
    .from(teamProfiles)
    .where(
      inArray(
        teamProfiles.teamNumber,
        claimed.map((c) => c.teamNumber),
      ),
    )
  const existingKeys = new Set(existing.map((e) => `${e.program}:${e.teamNumber}`))

  return claimed
    .filter((c) => !mineKeys.has(`${c.program}:${c.teamNumber}`))
    .map((c) => ({
      program: c.program,
      teamNumber: c.teamNumber,
      takenByOthers: existingKeys.has(`${c.program}:${c.teamNumber}`),
    }))
}

// #endregion

// #region what an empty field is costing

/** One profile field, and the grants currently stuck on it. */
export interface MissingFieldCost {
  /** team_profiles column name, as the matcher writes it into missingFields. */
  field: string
  /** Live 'missing_info' matches naming this field. */
  grantCount: number
  /** A few grant names, so the nag is concrete rather than a number. */
  examples: string[]
}

export interface MatchCostSummary {
  /** Empty fields ranked by how many grants are waiting on them. */
  costs: MissingFieldCost[]
  /** Live matches with verdict 'missing_info'. */
  missingInfoCount: number
  /** Live matches the team can already act on. */
  actionableCount: number
  /**
   * True when the matcher has never produced a row for this profile. A brand
   * new profile has no matches until the job runs, and showing "0 grants are
   * waiting on this" would read as "nothing to gain here", which is a lie.
   */
  neverMatched: boolean
}

/** How many grant names to keep per field. Small on purpose: this is a nudge, not a list. */
const EXAMPLE_LIMIT = 3

/**
 * Which unfilled fields are actually costing this team matches.
 *
 * A bare progress bar tells a team they are at 61% and nothing else. This tells
 * them that eleven grants are sitting in 'missing_info' because nobody has said
 * whether the school is Title I, which is the sentence that gets the box
 * ticked.
 *
 * Only live matches count: the grant is still published and the team has not
 * dismissed it. Dismissed matches are the team's own decision and must not be
 * used to nag them.
 */
export async function getMatchCostSummary(profileId: string): Promise<MatchCostSummary> {
  const db = getDb()

  const rows = await db
    .select({
      verdict: grantMatches.verdict,
      missingFields: grantMatches.missingFields,
      grantName: grants.name,
      score: grantMatches.score,
    })
    .from(grantMatches)
    .innerJoin(grants, eq(grants.id, grantMatches.grantId))
    .where(
      and(
        eq(grantMatches.profileId, profileId),
        isNull(grantMatches.dismissedAt),
        eq(grants.status, 'published'),
      ),
    )
    // Highest scoring first, so the example grant names are the ones worth
    // chasing rather than whatever the planner happened to return.
    .orderBy(desc(grantMatches.score))

  const byField = new Map<string, MissingFieldCost>()
  let missingInfoCount = 0
  let actionableCount = 0

  for (const row of rows) {
    if (row.verdict === 'missing_info') {
      missingInfoCount++
      for (const field of row.missingFields ?? []) {
        const entry = byField.get(field) ?? { field, grantCount: 0, examples: [] }
        entry.grantCount++
        if (entry.examples.length < EXAMPLE_LIMIT) entry.examples.push(row.grantName)
        byField.set(field, entry)
      }
    } else {
      actionableCount++
    }
  }

  const costs = [...byField.values()].sort(
    (a, b) => b.grantCount - a.grantCount || a.field.localeCompare(b.field),
  )

  return {
    costs,
    missingInfoCount,
    actionableCount,
    neverMatched: rows.length === 0,
  }
}

// #endregion
