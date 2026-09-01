/**
 * "You submitted it, so you run it" - granted at APPROVAL.
 *
 * THE PROBLEM THIS FIXES. Someone signs in, submits their photo album, a
 * moderator approves it, and /me/listings says they own nothing. Practice
 * fields had a route to ownership (the claim page reads practice_fields
 * .submitted_by_user_id and grants on the spot) and nothing else did, so in
 * production listing_owners held two tool rows and not one other thing.
 *
 * WHY THIS IS NOT A CLAIM. app/me/listings/actions.ts exists to keep one rule:
 * a self-asserted claim never writes a listing_owners row. That rule is intact.
 * A submitter id is not self-asserted. Our own route wrote it from the session
 * cookie at the moment the row was created, and nobody can post one. It is the
 * same evidence practice fields have always accepted, and it is the strongest
 * signal on the site short of a repo file.
 *
 * WHY AT APPROVAL AND NOT AT SUBMIT. A pending row is not a listing. It has no
 * public page, it may be rejected, and it may be edited past recognition by the
 * moderator who publishes it. Granting at submit would put things in "Your
 * listings" that nobody else can see and some of which will never exist.
 *
 * FOUR THINGS THIS WILL NOT DO.
 *   1. No user, nothing happens. Anonymous submission is a first-class case on
 *      every public form here and it stays anonymous.
 *   2. submitter_owns = false, nothing happens. The person ticked "I am only
 *      passing this along" and that is the end of it.
 *   3. A listing that ALREADY has an owner is left alone. A moderator merging a
 *      second submission into an existing listing must not hand it to the
 *      second submitter.
 *   4. It never throws. The approval has already happened by the time any of
 *      this runs, and a permission row that failed to write must not turn a
 *      published listing into a red box on the admin's screen. A failure is one
 *      log line, and the submitter can still claim it the normal way.
 */
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import {
  albumCandidates,
  albumSubmissions,
  crawlCandidates,
  eventListings,
  grantCandidates,
  listingClaims,
  listingOwners,
  practiceFields,
  submissions,
  type ListingEntityType,
} from '@the-tool-pit/db'

// #region the write

/** What we know about the person behind a submission. */
interface Submitter {
  userId: string | null
  /** practice_fields.submitter_owns and friends. NULL means never asked. */
  submitterOwns: boolean | null
}

/**
 * NULL is a yes.
 *
 * Rows written before the form carried the box have submitter_owns NULL. Those
 * people were never asked, and the default the form now uses for their vertical
 * is what they would have seen, so refusing them would be inventing a decline
 * they never made. Only an explicit false declines.
 */
function wantsOwnership(s: Submitter): boolean {
  return s.userId !== null && s.submitterOwns !== false
}

/**
 * Grant the submitter ownership of a listing that has just been approved.
 *
 * Writes the listing_owners row AND a settled listing_claims row, so /me
 * shows the same "Your own submission" audit line the claim page produces for
 * a field. Nothing here is reachable by a request: every caller is an admin
 * action that has already published the row.
 */
async function grantToSubmitter(
  entityType: ListingEntityType,
  entityId: string,
  submitter: Submitter,
  label: string,
): Promise<void> {
  try {
    if (!wantsOwnership(submitter)) return
    const userId = submitter.userId as string
    const db = getDb()

    // Never take a listing off whoever already holds it, and never quietly add
    // a second owner to one. A contested listing goes through the claim queue
    // where a person decides, which is what that queue is for.
    const [existingOwner] = await db
      .select({ id: listingOwners.id })
      .from(listingOwners)
      .where(and(eq(listingOwners.entityType, entityType), eq(listingOwners.entityId, entityId)))
      .limit(1)
    if (existingOwner) return

    await db
      .insert(listingOwners)
      .values({ entityType, entityId, userId, role: 'owner', verifiedVia: 'self_submitted', invitedBy: null })
      .onConflictDoNothing()

    await db.insert(listingClaims).values({
      entityType,
      entityId,
      userId,
      method: 'self_submitted',
      status: 'verified',
      decidedByUserId: userId,
      decidedAt: new Date(),
    })
  } catch (err) {
    console.error(`[ownership] ${label} could not be granted: ${(err as Error).message}`)
  }
}

// #endregion

// #region one door per vertical
//
// Each of these resolves the submitter from the row the admin action already
// has in hand, so an admin action calls one line and stays about moderation.
// The lookup shapes mirror lib/notify/approvals.ts on purpose: the same joins
// answer "who do we email" and "who now runs this".

/** A practice field was published. The row IS the listing, so the id is its own. */
export async function grantFieldOwnership(fieldId: string): Promise<void> {
  try {
    const db = getDb()
    const [row] = await db
      .select({ userId: practiceFields.submittedByUserId, owns: practiceFields.submitterOwns })
      .from(practiceFields)
      .where(eq(practiceFields.id, fieldId))
      .limit(1)
    if (!row) return
    await grantToSubmitter('field', fieldId, { userId: row.userId, submitterOwns: row.owns }, `field ${fieldId}`)
  } catch (err) {
    console.error(`[ownership] field ${fieldId} lookup failed: ${(err as Error).message}`)
  }
}

/** An off-season event listing was published. */
export async function grantEventOwnership(listingId: string): Promise<void> {
  try {
    const db = getDb()
    const [row] = await db
      .select({ userId: eventListings.submittedByUserId, owns: eventListings.submitterOwns })
      .from(eventListings)
      .where(eq(eventListings.id, listingId))
      .limit(1)
    if (!row) return
    await grantToSubmitter('event', listingId, { userId: row.userId, submitterOwns: row.owns }, `event ${listingId}`)
  } catch (err) {
    console.error(`[ownership] event ${listingId} lookup failed: ${(err as Error).message}`)
  }
}

/**
 * An album candidate was matched to its event and published.
 *
 * Two hops, because the submitter lives on album_submissions and the listing is
 * the albums row the publish just created. A candidate a crawler found has no
 * submission at all and falls straight through without a second query.
 */
export async function grantAlbumOwnership(candidateId: string, albumId: string): Promise<void> {
  try {
    const db = getDb()
    const [candidate] = await db
      .select({ submissionId: albumCandidates.submissionId })
      .from(albumCandidates)
      .where(eq(albumCandidates.id, candidateId))
      .limit(1)
    if (!candidate?.submissionId) return

    const [submission] = await db
      .select({ userId: albumSubmissions.submittedByUserId, owns: albumSubmissions.submitterOwns })
      .from(albumSubmissions)
      .where(eq(albumSubmissions.id, candidate.submissionId))
      .limit(1)
    if (!submission) return

    await grantToSubmitter(
      'album',
      albumId,
      { userId: submission.userId, submitterOwns: submission.owns },
      `album ${albumId}`,
    )
  } catch (err) {
    console.error(`[ownership] album ${albumId} lookup failed: ${(err as Error).message}`)
  }
}

/**
 * A crawl candidate reached the directory as a tool.
 *
 * Covers both the generic tool form and the robot code / CAD form: they land in
 * the same `submissions` table and publish through the same candidate, which is
 * why there is one function and not two.
 */
export async function grantToolOwnership(candidateId: string, toolId: string): Promise<void> {
  try {
    const db = getDb()
    const [candidate] = await db
      .select({ submissionId: crawlCandidates.submissionId })
      .from(crawlCandidates)
      .where(eq(crawlCandidates.id, candidateId))
      .limit(1)
    if (!candidate?.submissionId) return

    const [submission] = await db
      .select({ userId: submissions.submittedByUserId, owns: submissions.submitterOwns })
      .from(submissions)
      .where(eq(submissions.id, candidate.submissionId))
      .limit(1)
    if (!submission) return

    await grantToSubmitter(
      'tool',
      toolId,
      { userId: submission.userId, submitterOwns: submission.owns },
      `tool ${toolId}`,
    )
  } catch (err) {
    console.error(`[ownership] tool ${toolId} lookup failed: ${(err as Error).message}`)
  }
}

/**
 * A submitted grant was checked and listed.
 *
 * No different from the other four. A team administers grants it has won and a
 * programme officer submits their own, and both of those are people who should
 * be able to correct the write-up without asking. The dates and amounts are
 * still a reviewer's, which is a limit on what an owner may EDIT, not on who
 * gets to own it. See LISTING_REVIEW_NOTE in components/me/listing-fields.ts.
 */
export async function grantGrantOwnership(candidateId: string, grantId: string): Promise<void> {
  try {
    const db = getDb()
    const [candidate] = await db
      .select({ userId: grantCandidates.submittedByUserId, owns: grantCandidates.submitterOwns })
      .from(grantCandidates)
      .where(eq(grantCandidates.id, candidateId))
      .limit(1)
    if (!candidate) return
    await grantToSubmitter(
      'grant',
      grantId,
      { userId: candidate.userId, submitterOwns: candidate.owns },
      `grant ${grantId}`,
    )
  } catch (err) {
    console.error(`[ownership] grant ${grantId} lookup failed: ${(err as Error).message}`)
  }
}

// #endregion
