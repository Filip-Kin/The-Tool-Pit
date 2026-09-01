'use server'

import { randomBytes, createHash } from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import {
  albumCovers,
  albums,
  eventListings,
  events,
  fieldPhotos,
  grants,
  listingClaims,
  listingInvites,
  listingOwners,
  practiceFields,
  toolLinks,
  tools,
  TOOL_TYPES,
  addHumanEdits,
  changedKeys,
  linkMarker,
  HUMAN_EDITABLE_TOOL_KEYS,
  type ClaimEvidence,
  type ListingEntityType,
  type ListingOwnerRole,
} from '@the-tool-pit/db'
import { getCurrentUser } from '@/lib/auth/session'
import {
  canEditListing,
  countOwners,
  getOwnerRole,
  isListingEntityType,
  listingColumnFields,
  loadListingFormContext,
  loadToolLinks,
  resolveClaimable,
} from '@/lib/queries/listing-ownership'
import {
  OWNER_LINK_TYPES,
  TOOL_TAG_KEYS,
  linkFieldKey,
  listingFormSpec,
  parseListingValues,
  type ListingFormContext,
} from '@/components/me/listing-fields'
import {
  loadToolTaxonomy,
  saveToolTaxonomy,
  taxonomyOptions,
  type TaxonomyOptions,
  type ToolTaxonomy,
} from '@/lib/listings/tool-taxonomy'
import { notifyClaimResolved } from '@/lib/notify/approvals'
import { normaliseUploadedImage } from '@/lib/images/normalise'
import { MAX_PHOTOS, readPhotoFiles } from '@/lib/fields/form-parse'
import { sendApprovalNotice, reviewClaimUrl } from '@the-tool-pit/types'
import { entityNoun } from '@/components/me/listing-labels'
import { refreshListingPopularity, linkChangeNeedsPopularityRefresh } from '@/lib/queues/popularity'

/**
 * Listing ownership writes.
 *
 * The one rule the whole file exists to keep: a self-asserted claim must never
 * put a listing_owners row into the table. Ownership is only ever written here
 * by three paths, each of which is proof or a decision, never a bare claim:
 *
 *   1. You submitted it yourself, whatever the vertical, and did not disclaim
 *      it on the form (we hold the submitter id, written from the session by
 *      our own route; nobody can post one).
 *   2. You proved control of the listing's GitHub repo (a token we set, that
 *      you committed, that we then fetched back).
 *   3. An existing owner invited you, or an admin decided.
 *
 * Claiming an already-owned listing NEVER auto-grants: it becomes a pending
 * dispute an admin resolves, so a second person cannot take over what someone
 * else set up. Anonymous submit and suggest-edit are untouched by any of this.
 */

// #region shared helpers

export interface OwnershipActionResult {
  error?: string
  /** A short, plain sentence to show the user on success. */
  message?: string
  /** repo_file: the token the user must commit, and where to put it. */
  verifyToken?: string
  /** An invite link to copy, for createInvite. */
  inviteUrl?: string
}

/** The file we ask a repo owner to add, and the branches we look on. */
const VERIFY_FILENAME = '.frc-tools-verify'
const VERIFY_BRANCHES = ['main', 'master'] as const

/** Generate a URL-safe token and its sha256, for invites and repo proof. */
function mintToken(): { raw: string; hash: string } {
  const raw = randomBytes(24).toString('base64url')
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Where invite links live. Built from the canonical origin, never a request host. */
function inviteLink(token: string): string {
  const origin = (process.env.NEXT_PUBLIC_URL ?? 'https://frc.tools').replace(/\/+$/, '')
  return `${origin}/me/listings/invite?token=${token}`
}

/**
 * owner/owner/repo from a GitHub URL, or null. Kept strict: only github.com,
 * only the first two path segments, so a random URL cannot point the fetch at
 * an attacker's host.
 */
function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url)
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    const owner = parts[0]
    const repo = parts[1].replace(/\.git$/i, '')
    if (!owner || !repo) return null
    return { owner, repo }
  } catch {
    return null
  }
}

// #endregion

// #region claim

/**
 * Start (or resume) a claim on a listing.
 *
 * Picks the strongest verification path available and either grants ownership
 * on the spot (only when that path is real proof) or records a pending claim.
 * Never grants ownership of an already-owned listing.
 *
 * `note` is what the claimant says about themselves. It is REQUIRED on the
 * review path, which is every claim we cannot check by machine, so nobody can
 * file a wordless claim on a listing they have nothing to do with.
 */
export async function startClaim(
  entityTypeRaw: string,
  entityId: string,
  noteRaw?: string,
): Promise<OwnershipActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Your session expired. Sign in again and retry.' }
  if (!isListingEntityType(entityTypeRaw)) return { error: 'Unknown listing type.' }
  const entityType = entityTypeRaw

  const target = await resolveClaimable(user.id, entityType, entityId)
  // Same answer for "no such listing" and a bad id, so a guessed UUID reveals
  // nothing about what exists.
  if (!target) return { error: 'We could not find that listing.' }

  const db = getDb()

  // Already own it? Nothing to do.
  if ((await getOwnerRole(user.id, entityType, entityId)) !== null) {
    return { message: 'You already manage this listing.' }
  }

  // One open claim per user per listing. A second attempt returns the existing
  // one rather than stacking rows, and hands back the repo token if there is one.
  const [existing] = await db
    .select({ id: listingClaims.id, method: listingClaims.method, status: listingClaims.status, evidence: listingClaims.evidence })
    .from(listingClaims)
    .where(
      and(
        eq(listingClaims.userId, user.id),
        eq(listingClaims.entityType, entityType),
        eq(listingClaims.entityId, entityId),
        eq(listingClaims.status, 'pending'),
      ),
    )
    .limit(1)
  if (existing) {
    if (existing.method === 'repo_file' && existing.evidence?.token) {
      return { verifyToken: existing.evidence.token, message: 'You already started this claim.' }
    }
    return { message: 'This claim is already waiting for review.' }
  }

  // PATH 1: you submitted this listing while signed in, and did not tick "I am
  // only passing this along". Strongest signal on the site short of a repo
  // file, and only for an unowned listing, so it can grant on the spot. Every
  // vertical now, which is what lets somebody pick up a listing that was
  // approved before ownership was granted at approval.
  if (target.isSelfSubmitted && !target.alreadyOwned) {
    await grantOwnership(entityType, entityId, user.id, 'owner', 'self_submitted', null)
    await db.insert(listingClaims).values({
      entityType,
      entityId,
      userId: user.id,
      method: 'self_submitted',
      status: 'verified',
      decidedByUserId: user.id,
      decidedAt: new Date(),
    })
    revalidatePath('/me/listings')
    return { message: 'This is your submission, so you now manage it.' }
  }

  // PATH 2: a tool with a GitHub repo, and nobody owns it yet. Issue a token to
  // commit; ownership is granted only after verifyRepoClaim fetches it back.
  if (entityType === 'tool' && target.repoUrl && !target.alreadyOwned) {
    const { raw } = mintToken()
    const evidence: ClaimEvidence = { repoUrl: target.repoUrl, token: raw }
    await db.insert(listingClaims).values({
      entityType,
      entityId,
      userId: user.id,
      method: 'repo_file',
      status: 'pending',
      evidence,
    })
    revalidatePath('/me/listings')
    return {
      verifyToken: raw,
      message: `Add a file named ${VERIFY_FILENAME} containing this token to the default branch of your repo, then check it here.`,
    }
  }

  // PATH 3: no automatic proof (album, non-repo tool, someone else's field), OR
  // the listing is already owned (a dispute). Held for an admin. No owner row.
  //
  // This path asks for words because it has nothing else. The reviewer is a
  // person deciding between two strangers, and an unexplained claim gives them
  // nothing to decide on, so we refuse to file one. The note is never treated
  // as proof: it only ever reaches an admin, and only an admin's approval
  // writes an ownership row.
  // Something rather than nothing. A character count was arbitrary and did not
  // make a claim any more checkable: a long note is not proof and a short one
  // pointing at a public page is. An admin reads it either way.
  const note = (noteRaw ?? '').trim().slice(0, 1000)
  if (!note) {
    return { error: 'Say how you are connected to it. An admin reads this.' }
  }
  const [filed] = await db
    .insert(listingClaims)
    .values({
      entityType,
      entityId,
      userId: user.id,
      method: 'manual_review',
      status: 'pending',
      evidence: { note },
    })
    .returning({ id: listingClaims.id })

  // NEWLY WIRED. This queue is the one nobody was told about: a claim sat in
  // /admin/claims until somebody happened to open the page, and it is the queue
  // where a real person is waiting on an answer about something they say is
  // theirs. A dispute says so in the title, because it is the one a reviewer
  // must not rubber-stamp.
  sendApprovalNotice({
    vertical: 'claim',
    title: `${entityNoun(entityType)} · ${target.facts.title}`,
    reviewUrl: reviewClaimUrl(filed.id),
    submitter: user.displayName ?? user.email ?? null,
    facts: [
      { label: 'Contested', value: target.alreadyOwned ? 'Yes, this listing already has an owner' : 'No, nobody owns it yet' },
      { label: 'They say', value: note },
      { label: 'Listing', value: target.facts.subtitle },
    ],
  })

  revalidatePath('/me/listings')
  return {
    message: target.alreadyOwned
      ? 'This listing already has an owner, so an admin will review your claim.'
      : 'Sent. An admin will review your claim.',
  }
}

/**
 * Check a repo_file claim: fetch the well-known file and match the token.
 *
 * Only grants ownership if the listing is STILL unowned when the proof lands,
 * so a claim that was legitimate when started cannot override an owner added in
 * the meantime; that case falls back to a pending dispute.
 */
export async function verifyRepoClaim(claimId: string): Promise<OwnershipActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Your session expired. Sign in again and retry.' }

  const db = getDb()
  const [claim] = await db
    .select()
    .from(listingClaims)
    .where(and(eq(listingClaims.id, claimId), eq(listingClaims.userId, user.id)))
    .limit(1)
  if (!claim) return { error: 'We could not find that claim.' }
  if (claim.status !== 'pending') return { message: 'This claim is already settled.' }
  if (claim.method !== 'repo_file' || !claim.evidence?.repoUrl || !claim.evidence?.token) {
    return { error: 'This claim is not a repository check.' }
  }
  if (!isListingEntityType(claim.entityType)) return { error: 'Unknown listing type.' }

  const repo = parseGithubRepo(claim.evidence.repoUrl)
  if (!repo) return { error: 'That claim has no GitHub repository to check.' }

  const found = await repoFileHasToken(repo.owner, repo.repo, claim.evidence.token)
  if (!found.ok) {
    return {
      error: `We did not find the token in ${VERIFY_FILENAME} on that repo yet. Commit it to the default branch and try again.`,
    }
  }

  // Only grant when still unowned. If someone else got verified first, keep this
  // as a dispute rather than silently adding a second owner.
  if ((await countOwners(claim.entityType, claim.entityId)) > 0) {
    await db
      .update(listingClaims)
      .set({
        evidence: { ...claim.evidence, checkedUrl: found.url },
        reviewerNote: 'Repo proof passed but the listing was already owned. Held for review.',
      })
      .where(eq(listingClaims.id, claim.id))
    // Real proof that landed on an owned listing. This is the sharpest dispute
    // the site can produce and it used to arrive silently.
    sendApprovalNotice({
      vertical: 'claim',
      title: `${entityNoun(claim.entityType)} · repo proof on an owned listing`,
      reviewUrl: reviewClaimUrl(claim.id),
      submitter: user.displayName ?? user.email ?? null,
      facts: [
        { label: 'Contested', value: 'Yes, and the claimant proved control of the repo' },
        { label: 'Repo', value: claim.evidence.repoUrl },
        { label: 'File we read', value: found.url },
      ],
    })
    revalidatePath('/me/listings')
    return { message: 'Your repo checked out, but this listing already has an owner. An admin will review it.' }
  }

  await grantOwnership(claim.entityType, claim.entityId, user.id, 'owner', 'repo_file', null)
  await db
    .update(listingClaims)
    .set({
      status: 'verified',
      evidence: { ...claim.evidence, checkedUrl: found.url },
      decidedByUserId: user.id,
      decidedAt: new Date(),
    })
    .where(eq(listingClaims.id, claim.id))

  revalidatePath('/me/listings')
  return { message: 'Verified. You now manage this listing.' }
}

/** Fetch the raw well-known file on each candidate branch, looking for the token. */
async function repoFileHasToken(
  owner: string,
  repo: string,
  token: string,
): Promise<{ ok: boolean; url?: string }> {
  for (const branch of VERIFY_BRANCHES) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${VERIFY_FILENAME}`
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) continue
      const body = (await res.text()).slice(0, 4096)
      if (body.includes(token)) return { ok: true, url }
    } catch {
      // Network hiccup on one branch should not abort the other.
    }
  }
  return { ok: false }
}

// #endregion

// #region ownership row writer
//
// The single choke point that inserts a listing_owners row. Everything that
// grants ownership funnels through here so the audit trail (verifiedVia) is
// never left blank and the unique index is always respected.

async function grantOwnership(
  entityType: ListingEntityType,
  entityId: string,
  userId: string,
  role: ListingOwnerRole,
  verifiedVia: string,
  invitedBy: string | null,
): Promise<void> {
  const db = getDb()
  await db
    .insert(listingOwners)
    .values({ entityType, entityId, userId, role, verifiedVia, invitedBy })
    .onConflictDoNothing()
}

// #endregion

// #region invites

/** An owner mints a single-use link. Only owners may invite; invitees are editors. */
export async function createInvite(
  entityTypeRaw: string,
  entityId: string,
  roleRaw: string,
  email: string | null,
): Promise<OwnershipActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Your session expired. Sign in again and retry.' }
  if (!isListingEntityType(entityTypeRaw)) return { error: 'Unknown listing type.' }
  const entityType = entityTypeRaw

  // Only an owner hands out access. An editor can edit but not widen the circle.
  if ((await getOwnerRole(user.id, entityType, entityId)) !== 'owner') {
    return { error: 'Only an owner of this listing can invite others.' }
  }
  // Never invite straight to owner; ownership transfer is an admin action.
  const role: ListingOwnerRole = roleRaw === 'viewer' ? 'viewer' : 'editor'

  const { raw, hash } = mintToken()
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days
  const db = getDb()
  await db.insert(listingInvites).values({
    entityType,
    entityId,
    role,
    tokenHash: hash,
    invitedByUserId: user.id,
    email: email && email.includes('@') ? email.trim().toLowerCase() : null,
    expiresAt,
  })
  return { inviteUrl: inviteLink(raw), message: 'Invite link created. It works once and expires in 14 days.' }
}

/** Accept an invite: validate the token, then write the ownership row. */
export async function acceptInvite(token: string): Promise<OwnershipActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Sign in first, then open the invite link again.' }
  if (!token) return { error: 'That invite link is missing its token.' }

  const db = getDb()
  const [invite] = await db
    .select()
    .from(listingInvites)
    .where(eq(listingInvites.tokenHash, hashToken(token)))
    .limit(1)
  if (!invite) return { error: 'That invite link is not valid.' }
  if (invite.usedAt) return { error: 'That invite link has already been used.' }
  if (invite.expiresAt.getTime() < Date.now()) return { error: 'That invite link has expired.' }
  if (invite.email) {
    // Pinned to an email: only that verified address may accept, so a leaked
    // link is useless to anyone else.
    if (!user.emailVerified || user.email?.trim().toLowerCase() !== invite.email) {
      return { error: 'This invite was sent to a different email address.' }
    }
  }
  if (!isListingEntityType(invite.entityType)) return { error: 'Unknown listing type.' }

  // Claim the invite ATOMICALLY before granting anything. The WHERE requires
  // it to still be unused, so of two people racing the same single-use link,
  // only one UPDATE returns a row; the other gets nothing and is turned away.
  // Grant only after we have won that update, never before.
  const [claimed] = await db
    .update(listingInvites)
    .set({ usedAt: new Date(), usedByUserId: user.id })
    .where(and(eq(listingInvites.id, invite.id), isNull(listingInvites.usedAt)))
    .returning({ id: listingInvites.id })
  if (!claimed) return { error: 'That invite link has already been used.' }

  await grantOwnership(
    invite.entityType,
    invite.entityId,
    user.id,
    invite.role as ListingOwnerRole,
    'invite',
    invite.invitedByUserId,
  )

  revalidatePath('/me/listings')
  return { message: 'You now have access to this listing.' }
}

// #endregion

// #region member management

/**
 * Remove a member from a listing. An owner may remove anyone; anyone may remove
 * themselves. The last owner cannot be removed, so a listing never ends up with
 * nobody able to manage it.
 */
export async function removeOwner(
  entityTypeRaw: string,
  entityId: string,
  targetUserId: string,
): Promise<OwnershipActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Your session expired. Sign in again and retry.' }
  if (!isListingEntityType(entityTypeRaw)) return { error: 'Unknown listing type.' }
  const entityType = entityTypeRaw

  const myRole = await getOwnerRole(user.id, entityType, entityId)
  if (myRole === null) return { error: 'You do not manage this listing.' }
  // The client never holds a trusted user id. '__self__' (or an empty value)
  // means "remove me", resolved from the session rather than the argument.
  const targetId = targetUserId && targetUserId !== '__self__' ? targetUserId : user.id
  const removingSelf = targetId === user.id
  if (!removingSelf && myRole !== 'owner') {
    return { error: 'Only an owner can remove other members.' }
  }

  const db = getDb()
  const [target] = await db
    .select({ id: listingOwners.id, role: listingOwners.role })
    .from(listingOwners)
    .where(
      and(
        eq(listingOwners.entityType, entityType),
        eq(listingOwners.entityId, entityId),
        eq(listingOwners.userId, targetId),
      ),
    )
    .limit(1)
  if (!target) return { error: 'That person does not manage this listing.' }

  if (target.role === 'owner' && (await countOwners(entityType, entityId)) <= 1) {
    return { error: 'This is the only owner. Invite another owner first, or ask an admin to reassign it.' }
  }

  await db.delete(listingOwners).where(eq(listingOwners.id, target.id))
  revalidatePath('/me/listings')
  return { message: removingSelf ? 'You have left this listing.' : 'Member removed.' }
}

// #endregion

// #region admin

/**
 * Admin resolves a pending claim. isAdmin is a DB-only flag (never a Firebase
 * claim), so this cannot be reached by a self-asserted admin.
 *
 * The note is OPTIONAL on an approval and REQUIRED on a rejection. Approving
 * explains itself: the claimant now manages the listing and can see that they
 * do. A rejection explains nothing on its own, and "no" with no reason is the
 * thing people write back about, so the note is the body of the email and the
 * decision does not go through without one.
 */
export async function adminResolveClaim(
  claimId: string,
  approve: boolean,
  note: string | null,
): Promise<OwnershipActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Your session expired. Sign in again and retry.' }
  if (!user.isAdmin) return { error: 'Admins only.' }
  const cleanNote = note?.trim() || null
  if (!approve && !cleanNote) {
    return { error: 'Give a reason for turning the claim down. It is what the claimant is told.' }
  }

  const db = getDb()
  const [claim] = await db.select().from(listingClaims).where(eq(listingClaims.id, claimId)).limit(1)
  if (!claim) return { error: 'We could not find that claim.' }
  if (claim.status !== 'pending') return { message: 'This claim is already settled.' }
  if (!isListingEntityType(claim.entityType)) return { error: 'Unknown listing type.' }

  if (approve) {
    // An admin can grant even when the listing is already owned: this is how a
    // dispute is resolved or a co-owner added. Deliberately additive.
    await grantOwnership(claim.entityType, claim.entityId, claim.userId, 'owner', 'admin', null)
  }
  await db
    .update(listingClaims)
    .set({
      status: approve ? 'verified' : 'rejected',
      reviewerNote: cleanNote,
      decidedByUserId: user.id,
      decidedAt: new Date(),
    })
    .where(eq(listingClaims.id, claim.id))

  // A rejection is not an approval, and it gets its own email saying so, with
  // the reviewer's note verbatim. Guarded above by the status !== 'pending'
  // check, so a second decision cannot send a second time.
  await notifyClaimResolved(
    claim.id,
    claim.entityType,
    claim.entityId,
    claim.userId,
    approve ? 'verified' : 'rejected',
    cleanNote,
  )

  revalidatePath('/me/listings')
  return { message: approve ? 'Claim approved.' : 'Claim rejected.' }
}

// #endregion

// #region owner edits
//
// AN OWNER FACES NO REVIEW QUEUE ON THEIR OWN LISTING. Everything a visitor
// reads on the page is theirs to change, and it saves as they type. A practice
// field's location, its coverage, elements, perimeter, ceiling and FMS, and an
// event's map pin are all in the form. They used to sit behind
// field_edit_proposals, which is the right path for a STRANGER suggesting a
// change to somebody else's field and the wrong one for the person who owns it:
// it made the owner queue behind a moderator to correct their own address.
// The suggest-an-edit form on the public map is unchanged and still queues.
//
// WHAT IS NOT HERE, AND WHY. An owner never writes a column that expresses our
// judgement of their listing or its place in a ranking: status, isOfficial,
// isVendor, isRookieFriendly, confidenceScore, popularityScore, githubStars,
// chiefDelphiLikes, freshnessState, adminNotes and slug on a tool; provider,
// sourceType, canonicalUrl, url and eventId on an album; verifiedAt, verifiedBy
// and the deadline and amount columns on a grant; status, source and
// rejectionReason everywhere; tbaKey, registeredTeamCount and the roster
// counts on an event; and every submitter audit column wherever one exists.
// An owner controls the CONTENT, not the moderation state and not the metrics.
// The update set is built from components/me/listing-fields.ts, so none of them
// can arrive by accident: a column that is not a form field is not in the set.
//
// Anonymous submit and suggest-edit are untouched by any of this.
//
// THE CRAWLER. apps/worker/src/pipeline/publish.ts re-publishes a tool whose
// crawl candidate is matched to it, and that path used to overwrite the whole
// tool row and re-insert the homepage, github and forum links, which reverted
// every edit made here. It now reads tools.human_edited_fields and leaves
// anything in that list alone, and saveToolListing below is what writes it.
// A field is claimed by being CHANGED, not by the form being submitted, so a
// listing keeps getting fresher summaries and links for everything its owner
// has not spoken for. See packages/db/src/human-edited.ts.

/** Drop the keys a select left undefined, so they are not written as null. */
function columnSet(
  values: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (values[key] !== undefined) out[key] = values[key]
  }
  return out
}

/** The spec keys that are real columns on the listing's own table. */
function columnKeys(entityType: ListingEntityType, context: ListingFormContext = {}): string[] {
  return listingColumnFields(entityType, context).map((f) => f.key)
}

/** The allowed slugs per tag field, for the parser to check a post against. */
function tagSlugs(options: TaxonomyOptions): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {}
  for (const key of TOOL_TAG_KEYS) out[key] = (options[key] ?? []).map((o) => o.value)
  return out
}

/** The three tag values out of a parsed form, ready for saveToolTaxonomy. */
function pickTags(values: Record<string, unknown>): Partial<ToolTaxonomy> {
  const out: Partial<ToolTaxonomy> = {}
  for (const key of TOOL_TAG_KEYS) {
    const value = values[key]
    if (Array.isArray(value)) out[key] = value.map(String)
  }
  return out
}

/**
 * An owner may MOVE their pin. They may not erase it.
 *
 * Both queues refuse to publish a listing with no coordinates, because the map
 * only carries what it can place, and a live listing whose pin was blanked
 * simply vanishes from the map with nothing on the page to say why. Clearing
 * the box is far more likely to be a slip than an intention, so an empty
 * coordinate is dropped from the update and the old pin stands. Typing a new
 * pair moves it immediately, with no review.
 */
function keepPinIfCleared(set: Record<string, unknown>): void {
  for (const key of ['latitude', 'longitude']) {
    if (set[key] === null) delete set[key]
  }
}

async function requireEditor(
  entityType: ListingEntityType,
  entityId: string,
): Promise<{ userId: string } | { error: string }> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Your session expired. Sign in again and retry.' }
  if (!(await canEditListing(user.id, entityType, entityId))) {
    // Same message for "not yours" and "no such listing".
    return { error: 'You do not have edit access to that listing.' }
  }
  return { userId: user.id }
}

/**
 * The one door every owner edit goes through.
 *
 * Gate, parse, write, in that order and never a different one. The gate reads
 * listing_owners for the signed-in user; the entity id comes off the form but
 * proves nothing on its own, which is exactly why the gate runs against it
 * before a single column is read or written.
 */
async function saveListing(
  entityType: ListingEntityType,
  formData: FormData,
  dynamicOptions: Record<string, readonly string[]> = {},
): Promise<
  | { result: OwnershipActionResult }
  | { entityId: string; values: Record<string, unknown>; context: ListingFormContext }
> {
  const entityId = String(formData.get('entityId') ?? '')
  const gate = await requireEditor(entityType, entityId)
  if ('error' in gate) return { result: gate }

  // The context is read AFTER the gate and BEFORE the parse, because it picks
  // the spec the parse walks. A tool that is not in the robot archive has no
  // archive group on its form, so isTeamCode and isTeamCad are not fields, are
  // not parsed and cannot be written. Parsing the full spec and hiding the
  // group at render time instead would read the two absent checkboxes as false
  // and quietly drop the listing out of the archive on the owner's first save.
  const context = await loadListingFormContext(entityType, entityId)

  const parsed = parseListingValues(listingFormSpec(entityType, context), formData, dynamicOptions)
  if ('error' in parsed) return { result: parsed }

  return { entityId, values: parsed.values, context }
}

export async function saveToolListing(formData: FormData): Promise<OwnershipActionResult> {
  const options = await taxonomyOptions()
  const step = await saveListing('tool', formData, {
    toolType: TOOL_TYPES,
    // The allowed slugs are the rows the picker was built from, so a posted tag
    // is checked against the same list the user was shown.
    ...tagSlugs(options),
  })
  if ('result' in step) return step.result
  const { entityId, values, context } = step

  const db = getDb()
  const set = columnSet(values, columnKeys('tool', context))

  // Read the row BEFORE the write. It is the only moment the before-state
  // exists, and a claim is earned by moving a value, not by pressing Save: an
  // autosave that changed nothing must not claim a summary the owner never read
  // and lock the crawler out of it forever. The tags are read the same way and
  // for the same reason, one table over.
  const [before] = await db
    .select()
    .from(tools)
    .where(eq(tools.id, entityId))
    .limit(1)
  const tagsBefore = await loadToolTaxonomy(entityId)

  const changedLinkTypes = await saveToolLinks(entityId, values)
  const claimed = [
    ...changedKeys(set, (before ?? {}) as Record<string, unknown>, HUMAN_EDITABLE_TOOL_KEYS),
    ...(await saveToolTaxonomy(entityId, tagsBefore, pickTags(values))),
    ...changedLinkTypes.map(linkMarker),
  ]
  const humanEditedFields = addHumanEdits(before?.humanEditedFields, claimed)

  await db
    .update(tools)
    .set({
      ...set,
      // Only when something was actually added, so a no-op save leaves the
      // column, and its ordering, exactly as it was.
      ...(humanEditedFields ? { humanEditedFields } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tools.id, entityId))

  // An owner who has just pasted their repo or their Chief Delphi thread should
  // see the stars and likes counted, not a zero until tomorrow morning.
  if (linkChangeNeedsPopularityRefresh(changedLinkTypes)) {
    await refreshListingPopularity(entityId)
  }

  revalidatePath('/me/listings')
  return { message: 'Saved.' }
}

/**
 * Write the owner's links, one row per type, touching only what changed.
 *
 * Rewriting all seven on every autosave would reset lastCheckedAt and isBroken
 * on links nobody edited, which is the link checker's memory of what it has
 * already been round. So the current rows are read first and a type is only
 * deleted and re-inserted when its URL actually moved. A type an owner clears
 * is deleted and not replaced, which is how you take a dead link down.
 *
 * Returns the types that moved, so the caller can mark them as claimed.
 * CLEARING a link counts: it leaves no row behind to carry a flag, which is
 * exactly why the marker lives on tools rather than on tool_links.
 */
async function saveToolLinks(toolId: string, values: Record<string, unknown>): Promise<string[]> {
  const db = getDb()
  const current = await loadToolLinks(toolId)
  const changed: string[] = []

  for (const type of OWNER_LINK_TYPES) {
    const next = (values[linkFieldKey(type)] as string | null) ?? null
    if ((current[type] ?? null) === next) continue

    await db.delete(toolLinks).where(and(eq(toolLinks.toolId, toolId), eq(toolLinks.linkType, type)))
    if (next) await db.insert(toolLinks).values({ toolId, linkType: type, url: next })
    changed.push(type)
  }

  return changed
}

export async function saveAlbumListing(formData: FormData): Promise<OwnershipActionResult> {
  const step = await saveListing('album', formData)
  if ('result' in step) return step.result

  const db = getDb()
  await db
    .update(albums)
    .set({ ...columnSet(step.values, columnKeys('album')), updatedAt: new Date() })
    .where(eq(albums.id, step.entityId))
  revalidatePath('/me/listings')
  revalidatePath('/photos')
  return { message: 'Saved.' }
}

/**
 * An owner sets the cover image on their own album.
 *
 * The picture is the whole card. Most album hosts hand us an og:image and we
 * scrape it, but Google Drive and Dropbox folders expose nothing and Flickr
 * blocks the cloud IP, so those albums have always sat on the event page as a
 * grey rectangle with nobody but an admin able to fix it. Now the photographer
 * can, which is the one person who has the picture.
 *
 * Not part of the autosaving form: a file upload is a deliberate act with its
 * own success and failure, and it has no business being fired on blur.
 *
 * The bytes go through lib/images/normalise.ts rather than being stored as
 * uploaded, which is the SAME path the admin upload uses: it caps the long
 * edge, re-encodes to WebP and drops EXIF, so a phone photo does not carry its
 * GPS coordinates onto a public page.
 */
export async function saveAlbumCover(formData: FormData): Promise<OwnershipActionResult> {
  const entityId = String(formData.get('entityId') ?? '')
  const gate = await requireEditor('album', entityId)
  if ('error' in gate) return gate

  const file = formData.get('cover')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose an image first.' }

  const normalised = await normaliseUploadedImage(file, 'cover')
  if ('error' in normalised) return { error: normalised.error }
  const { data, contentType } = normalised.image

  const db = getDb()
  const [album] = await db
    .select({ id: albums.id, eventId: albums.eventId })
    .from(albums)
    .where(eq(albums.id, entityId))
    .limit(1)
  if (!album) return { error: 'That album is no longer listed.' }

  await db
    .insert(albumCovers)
    .values({ albumId: album.id, contentType, data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: albumCovers.albumId,
      set: { contentType, data, updatedAt: new Date() },
    })

  // The version query busts every cache between here and the reader's browser.
  // Without it a replaced cover keeps showing the old picture, which reads as
  // the upload having failed.
  await db
    .update(albums)
    .set({ coverImageUrl: `/api/albums/cover/${album.id}?v=${Date.now()}`, updatedAt: new Date() })
    .where(eq(albums.id, album.id))

  revalidatePath('/me/listings')
  revalidatePath('/photos')
  const [event] = await db
    .select({ tbaKey: events.tbaKey })
    .from(events)
    .where(eq(events.id, album.eventId))
    .limit(1)
  if (event?.tbaKey) revalidatePath(`/photos/event/${event.tbaKey}`)

  return { message: 'Cover updated.' }
}

/**
 * A field owner adds photos of their own field.
 *
 * THE GAP THIS CLOSES. Every published field's page carries a gallery, and
 * until now only an admin could put anything in it: an owner could correct the
 * ceiling height and the access hours but could not show a team what the field
 * looks like, which is the first thing anybody scrolls for. The photos are the
 * listing.
 *
 * Not part of the autosaving form, for the reason the album cover panel gives:
 * an upload is a deliberate act with its own failures, and it has no business
 * firing on blur.
 *
 * The bytes go through lib/images/normalise.ts, the same path the submit form
 * and the admin editor use, so a phone photo is downscaled, re-encoded to WebP
 * and stripped of its GPS tags before it reaches a public page.
 */
export async function saveFieldPhotos(formData: FormData): Promise<OwnershipActionResult> {
  const entityId = String(formData.get('entityId') ?? '')
  const gate = await requireEditor('field', entityId)
  if ('error' in gate) return gate

  const parsed = await readPhotoFiles(formData, 'photos')
  if ('error' in parsed) return { error: parsed.error }
  if (parsed.photos.length === 0) return { error: 'Choose a photo first.' }

  const db = getDb()
  const existing = await db
    .select({ sortOrder: fieldPhotos.sortOrder })
    .from(fieldPhotos)
    .where(eq(fieldPhotos.fieldId, entityId))
  // Counted against what is already stored, not just against this batch. Eight
  // is the cap the submit form has always used, and a gallery is a gallery, not
  // an album host.
  if (existing.length + parsed.photos.length > MAX_PHOTOS) {
    return {
      error: `A field can show ${MAX_PHOTOS} photos. Remove one before adding another.`,
    }
  }

  let nextOrder = existing.reduce((max, r) => Math.max(max, r.sortOrder + 1), 0)
  await db.insert(fieldPhotos).values(
    parsed.photos.map((p) => ({
      fieldId: entityId,
      contentType: p.contentType,
      data: p.data,
      sortOrder: nextOrder++,
    })),
  )

  revalidatePath('/me/listings')
  revalidatePath('/fields')
  revalidatePath(`/fields/${entityId}`)
  return { message: parsed.photos.length === 1 ? 'Photo added.' : 'Photos added.' }
}

/**
 * Take one photo back down.
 *
 * The photo id comes off the client and proves nothing, so the delete is
 * scoped to the field the gate just passed on. Without that, an owner of any
 * one field could delete a photo from any other.
 */
export async function removeFieldPhoto(
  entityId: string,
  photoId: string,
): Promise<OwnershipActionResult> {
  const gate = await requireEditor('field', entityId)
  if ('error' in gate) return gate

  const db = getDb()
  await db
    .delete(fieldPhotos)
    .where(and(eq(fieldPhotos.id, photoId), eq(fieldPhotos.fieldId, entityId)))

  revalidatePath('/me/listings')
  revalidatePath('/fields')
  revalidatePath(`/fields/${entityId}`)
  return { message: 'Photo removed.' }
}

export async function saveFieldListing(formData: FormData): Promise<OwnershipActionResult> {
  const step = await saveListing('field', formData)
  if ('result' in step) return step.result
  const set = columnSet(step.values, columnKeys('field'))
  keepPinIfCleared(set)

  const db = getDb()
  await db
    .update(practiceFields)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(practiceFields.id, step.entityId))
  // The pin, the address and the spec are all on this form now, so the map and
  // the field's own page both have to be refreshed, not just /me.
  revalidatePath('/me/listings')
  revalidatePath('/fields')
  revalidatePath(`/fields/${step.entityId}`)
  return { message: 'Saved.' }
}

/**
 * A grant owner edits the words about their own programme.
 *
 * The narrowest of these five on purpose: the spec only carries summary,
 * description and the application link, and everything a reviewer verified
 * (name, funder, dates, amounts, eligibility) is simply not a form field, so it
 * cannot arrive here. grants.verifiedAt and verifiedBy are untouched, because
 * an owner rewriting their own blurb is not a re-verification of the funder's
 * page.
 */
export async function saveGrantListing(formData: FormData): Promise<OwnershipActionResult> {
  const step = await saveListing('grant', formData)
  if ('result' in step) return step.result

  const db = getDb()
  await db
    .update(grants)
    .set({ ...columnSet(step.values, columnKeys('grant')), updatedAt: new Date() })
    .where(eq(grants.id, step.entityId))
  revalidatePath('/me/listings')
  return { message: 'Saved.' }
}

export async function saveEventListing(formData: FormData): Promise<OwnershipActionResult> {
  const step = await saveListing('event', formData)
  if ('result' in step) return step.result
  const set = columnSet(step.values, columnKeys('event'))

  // One rule the columns cannot express on their own, taken from
  // lib/events/create-submission.ts so a submitted event and an edited one end
  // up in the same shape: an opening date only means anything while
  // registration has not opened. Only applied when the status was actually
  // posted, so a column we did not receive never clears one we did.
  if (set.registrationStatus !== undefined && set.registrationStatus !== 'not_open') {
    set.registrationOpensAt = null
  }

  keepPinIfCleared(set)

  const db = getDb()
  await db
    .update(eventListings)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(eventListings.id, step.entityId))
  revalidatePath('/me/listings')
  revalidatePath('/events')
  revalidatePath(`/events/${step.entityId}`)
  return { message: 'Saved.' }
}

// #endregion
