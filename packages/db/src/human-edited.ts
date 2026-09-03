/**
 * Which parts of a tool a person has claimed, so a crawl leaves them alone.
 *
 * THE BUG THIS EXISTS FOR. apps/worker/src/pipeline/publish.ts re-publishes a
 * tool whenever its crawl candidate comes round again, and that path rewrote
 * the whole row: name, summary, description, type, the team-code flags, the
 * team number, the season, the programs, both audience join tables, and the
 * homepage / github / forum links. So every edit an owner made on /me/listings,
 * and every correction an admin made in the tool editor, was reverted by the
 * next pass. Owner editing was cosmetic.
 *
 * THE SHAPE, AND WHY IT IS ONE ARRAY ON `tools` AND NOT A FLAG PER ROW.
 *
 * The obvious design is a `text[]` on tools for the columns plus an
 * `owner_set boolean` on tool_links for the links. It does not work, and the
 * case that breaks it is the one that matters most: CLEARING a link. An owner
 * who deletes a dead GitHub link leaves no tool_links row behind, so there is
 * no row to carry the flag, and the next crawl re-inserts exactly the link they
 * just took down. A boolean can only defend a value that exists.
 *
 * So link types live in the SAME array, written as `link:github`. One column,
 * one read in the re-publish, and "this link type is spoken for" survives the
 * row being deleted, which is the whole point.
 *
 * WHAT IS NOT IN HERE. Metrics are never claimable: githubStars,
 * chiefDelphiLikes, popularityScore and confidenceScore are counts we fetch,
 * not statements anyone made, and freezing a star count would be a bug rather
 * than a feature. A crawl keeps refreshing those on every tool, always.
 *
 * Zero dependencies on purpose, and exported as its own subpath, so the browser
 * bundle can reach it without pulling in the postgres client through the
 * @the-tool-pit/db barrel.
 */

// #region keys

/**
 * The tool keys a crawl re-publish overwrites and a human may therefore claim.
 *
 * This list is the contract between three files that must never disagree:
 * the worker's re-publish, the owner form's save action, and the admin tool
 * editor. A key added to the re-publish and not to this list is a field that
 * silently reverts again.
 *
 * `programs`, `audienceRoles` and `audienceFunctions` are not columns. They are
 * join tables the re-publish deletes and re-inserts wholesale, which reverts an
 * admin's filing just as thoroughly as overwriting a column would, so they are
 * claimable under the name the editors already post them under.
 */
export const HUMAN_EDITABLE_TOOL_KEYS = [
  'name',
  'summary',
  'description',
  'toolType',
  'isOfficial',
  'isVendor',
  'isRookieFriendly',
  'isTeamCode',
  'isTeamCad',
  'teamNumber',
  'seasonYear',
  'programs',
  'audienceRoles',
  'audienceFunctions',
  // A moderator's verdict and their reason for it.
  //
  // These are not written by the re-publish, which is why they were missing.
  // They are written by apps/worker/src/jobs/enrich.ts, which suppresses a tool
  // on re-classification and REPLACES adminNotes with its own line. 215 tools
  // carry a hand-written note today. An admin who un-suppresses a listing and
  // writes down why loses both the decision and the reason on the next pass,
  // with no history anywhere.
  'status',
  'adminNotes',
  // A curator saying "this one does not go stale".
  //
  // The state is computed from the last commit date, and for a repo that is the
  // right answer. It is the wrong answer for a reference that is finished: a
  // rulebook summary or a wiring diagram is not decaying because nobody pushed
  // to it this year. That is what 'evergreen' and 'seasonal' are FOR, and until
  // now nothing could produce them. computeFreshnessState returns five states
  // and neither of those two is among them, so the admin dropdown offered a
  // choice that the nightly pass reverted within a day, and production holds
  // zero rows of either.
  'freshnessState',
] as const

export type HumanEditableToolKey = (typeof HUMAN_EDITABLE_TOOL_KEYS)[number]

/** The link types the crawl re-publish deletes and re-inserts. */
export const CRAWL_MANAGED_LINK_TYPES = ['homepage', 'github', 'forum'] as const

// #endregion

// #region link markers

/** Namespace for a link type inside the same array as the columns. */
const LINK_PREFIX = 'link:'

/** `github` -> `link:github`. The form of a link type inside the marker list. */
export function linkMarker(linkType: string): string {
  return `${LINK_PREFIX}${linkType}`
}

/** `link:github` -> `github`, or null when the marker is a column, not a link. */
export function linkTypeFromMarker(marker: string): string | null {
  return marker.startsWith(LINK_PREFIX) ? marker.slice(LINK_PREFIX.length) : null
}

// #endregion

// #region reading

/**
 * Has a person claimed this key?
 *
 * Takes the column list straight off the row, including the null a row written
 * before the column existed still has, because a backfill that has not run yet
 * must read as "nobody has claimed anything" rather than throwing.
 */
export function isHumanEdited(
  humanEditedFields: readonly string[] | null | undefined,
  key: string,
): boolean {
  return Boolean(humanEditedFields?.includes(key))
}

/** Has a person claimed this LINK type? */
export function isHumanEditedLink(
  humanEditedFields: readonly string[] | null | undefined,
  linkType: string,
): boolean {
  return isHumanEdited(humanEditedFields, linkMarker(linkType))
}

// #endregion

// #region writing

/**
 * The list as it should be stored after a person edited `keys`.
 *
 * Additive and sorted: a claim is never given back by another edit, and the
 * stored order does not depend on the order the form happened to post in, so
 * two saves of the same thing produce the same array and not a spurious diff.
 *
 * Returns null when nothing was added, which the callers use to skip the write
 * entirely. An autosave that changed nothing should not touch the column.
 */
export function addHumanEdits(
  existing: readonly string[] | null | undefined,
  keys: readonly string[],
): string[] | null {
  const current = new Set(existing ?? [])
  let added = false
  for (const key of keys) {
    if (!key || current.has(key)) continue
    current.add(key)
    added = true
  }
  return added ? [...current].sort() : null
}

/**
 * Which of `keys` a person actually MOVED, comparing what they posted against
 * what the row already held.
 *
 * Marking every field on the form would claim a summary the owner never read
 * and freeze the crawler out of it forever. A claim means "a human set this
 * value", so it is earned by changing the value, not by pressing Save.
 *
 * Compared loosely through String(), because a form posts '' where a column
 * holds null and 3 where a column holds the number 3, and neither of those is
 * an edit. Undefined on either side means "not posted", never a change.
 */
export function changedKeys(
  posted: Record<string, unknown>,
  current: Record<string, unknown>,
  keys: readonly string[],
): string[] {
  const out: string[] = []
  for (const key of keys) {
    const next = posted[key]
    if (next === undefined) continue
    if (sameValue(next, current[key])) continue
    out.push(key)
  }
  return out
}

/** Loose equality for a posted value against a stored one. See changedKeys. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = [...(Array.isArray(a) ? a : [])].map(String).sort()
    const right = [...(Array.isArray(b) ? b : [])].map(String).sort()
    return left.length === right.length && left.every((v, i) => v === right[i])
  }
  return String(a ?? '') === String(b ?? '')
}

// #endregion

// #region events

/**
 * The event-listing fields a person owns, so no refresh may overwrite them.
 *
 * SPLIT BY WHO KNOWS BEST, not by who wrote last. An organiser moved their
 * event to a different gym; TBA has not heard yet, and TBA is wrong. A roster
 * count went up overnight; the organiser has not heard yet, and the organiser
 * is wrong. The first list is the first case.
 *
 * NOT HERE, because the machine owns them outright: registeredTeamCount and
 * teamCountUpdatedAt, which is a live count off TBA and the reason a refresh
 * job exists at all. Also not here: status, source, rejectionReason,
 * publishedAt and the submitter columns, which are the review system's own
 * bookkeeping rather than anything an organiser types.
 *
 * CONTESTED, and deliberately claimable: startDate, endDate, website and
 * tbaKey. TBA is usually right about dates, and an organiser who has moved
 * their event is more right. Claiming means a hand-set date survives, and a
 * disagreement with TBA becomes something to show a moderator rather than a
 * silent overwrite.
 */
export const HUMAN_EDITABLE_EVENT_KEYS = [
  'name',
  'program',
  'hostTeamNumber',
  'latitude',
  'longitude',
  'venueName',
  'address',
  'city',
  'region',
  'country',
  'seasonYear',
  'startDate',
  'endDate',
  'days',
  'parallelDivisions',
  'capacity',
  'costUsd',
  'costNote',
  'registrationStatus',
  'registrationOpensAt',
  'registrationClosesAt',
  'volunteerStatus',
  'eventStatus',
  'website',
  'registrationUrl',
  'volunteerUrl',
  'teamListUrl',
  'chiefDelphiUrl',
  'contactEmail',
  'notes',
  'tbaKey',
] as const

export type HumanEditableEventKey = (typeof HUMAN_EDITABLE_EVENT_KEYS)[number]

/**
 * Columns on event_listings that belong to the machine, whatever a person does.
 *
 * Written down so a refresh job can be checked against a list rather than
 * against somebody's memory of this conversation.
 */
export const MACHINE_OWNED_EVENT_KEYS = ['registeredTeamCount', 'teamCountUpdatedAt'] as const

// #endregion
