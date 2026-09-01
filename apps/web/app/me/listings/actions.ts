'use server'

import { randomBytes, createHash } from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db'
import {
  albums,
  listingClaims,
  listingInvites,
  listingOwners,
  practiceFields,
  tools,
  TOOL_TYPES,
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
  resolveClaimable,
} from '@/lib/queries/listing-ownership'

/**
 * Listing ownership writes.
 *
 * The one rule the whole file exists to keep: a self-asserted claim must never
 * put a listing_owners row into the table. Ownership is only ever written here
 * by three paths, each of which is proof or a decision, never a bare claim:
 *
 *   1. You submitted the field yourself (we hold the submitter id).
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

/**
 * The shortest claim note an admin can actually act on. A claim with no proof
 * behind it is a request, and a request with no words in it is unreviewable.
 */
const MIN_CLAIM_NOTE = 40

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

  // PATH 1: you submitted this field. Strongest signal, and only for an unowned
  // listing, so it can grant on the spot.
  if (entityType === 'field' && target.isSelfSubmitted && !target.alreadyOwned) {
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
  const note = (noteRaw ?? '').trim().slice(0, 1000)
  if (note.length < MIN_CLAIM_NOTE) {
    return {
      error: `We cannot check this one automatically, so tell us how you run it and an admin will read it. At least ${MIN_CLAIM_NOTE} characters.`,
    }
  }
  await db.insert(listingClaims).values({
    entityType,
    entityId,
    userId: user.id,
    method: 'manual_review',
    status: 'pending',
    evidence: { note },
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
 */
export async function adminResolveClaim(
  claimId: string,
  approve: boolean,
  note: string | null,
): Promise<OwnershipActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Your session expired. Sign in again and retry.' }
  if (!user.isAdmin) return { error: 'Admins only.' }

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
      reviewerNote: note,
      decidedByUserId: user.id,
      decidedAt: new Date(),
    })
    .where(eq(listingClaims.id, claim.id))

  revalidatePath('/me/listings')
  return { message: approve ? 'Claim approved.' : 'Claim rejected.' }
}

// #endregion

// #region owner edits
//
// An owner (or editor) edits their listing's DESCRIPTIVE fields directly. The
// admin-only columns (status, scores, isOfficial, adminNotes, freshness) are
// never in these forms and are not writable here. Anonymous and non-owner
// suggestions still go through the existing moderation queues, untouched.

function editText(form: FormData, name: string, maxLength: number): string | null {
  const raw = form.get(name)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  return trimmed.slice(0, maxLength)
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

export async function saveToolListing(formData: FormData): Promise<OwnershipActionResult> {
  const entityId = String(formData.get('entityId') ?? '')
  const gate = await requireEditor('tool', entityId)
  if ('error' in gate) return gate

  const name = editText(formData, 'name', 200)
  if (!name) return { error: 'A tool needs a name.' }
  const toolTypeRaw = String(formData.get('toolType') ?? '')
  const toolType = (TOOL_TYPES as readonly string[]).includes(toolTypeRaw) ? toolTypeRaw : undefined

  const db = getDb()
  await db
    .update(tools)
    .set({
      name,
      summary: editText(formData, 'summary', 500),
      description: editText(formData, 'description', 20_000),
      vendorName: editText(formData, 'vendorName', 200),
      ...(toolType ? { toolType } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tools.id, entityId))
  revalidatePath('/me/listings')
  return { message: 'Saved.' }
}

export async function saveAlbumListing(formData: FormData): Promise<OwnershipActionResult> {
  const entityId = String(formData.get('entityId') ?? '')
  const gate = await requireEditor('album', entityId)
  if ('error' in gate) return gate

  const db = getDb()
  await db
    .update(albums)
    .set({
      title: editText(formData, 'title', 300),
      photographer: editText(formData, 'photographer', 200),
      description: editText(formData, 'description', 5000),
      dateText: editText(formData, 'dateText', 120),
      updatedAt: new Date(),
    })
    .where(eq(albums.id, entityId))
  revalidatePath('/me/listings')
  return { message: 'Saved.' }
}

export async function saveFieldListing(formData: FormData): Promise<OwnershipActionResult> {
  const entityId = String(formData.get('entityId') ?? '')
  const gate = await requireEditor('field', entityId)
  if ('error' in gate) return gate

  const name = editText(formData, 'name', 200)
  if (!name) return { error: 'A field needs a name.' }

  const db = getDb()
  // Owner edits the access/contact/notes columns directly. Location and field
  // spec still route through field_edit_proposals, so a change to where a field
  // IS keeps its admin review; a change to how you reach it does not.
  await db
    .update(practiceFields)
    .set({
      name,
      hours: editText(formData, 'hours', 500),
      contactInfo: editText(formData, 'contactInfo', 1000),
      contactUrl: editText(formData, 'contactUrl', 500),
      website: editText(formData, 'website', 500),
      notes: editText(formData, 'notes', 2000),
      updatedAt: new Date(),
    })
    .where(eq(practiceFields.id, entityId))
  revalidatePath('/me/listings')
  return { message: 'Saved.' }
}

// #endregion
