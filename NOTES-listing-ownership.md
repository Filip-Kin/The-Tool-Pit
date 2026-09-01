# Listing ownership — design and build notes

Branch `feat/listing-ownership`, worktree `.../ttp-worktrees/ownership`. Do not merge or deploy.
Filip is asleep; work autonomously. Keep this file current as the restart lifeline.

## The task
A signed-in user can CLAIM and then EDIT the listings they own, across every vertical: a tool, a
photo album, a practice field, an off-season event. Sign-in makes editing easier; it must NEVER
wall off anonymous submit / suggest-edit (hard rule).

## What "a listing" is per vertical (established from schema)
- tool          -> `tools` row. An off-season event is a tool with `toolType='offseason_event'`,
                   so "off-season event" needs no separate entity type; it is a tool.
- photo album   -> `albums` row.
- practice field-> `practice_fields` row (already has nullable `submittedByUserId`, migration 0010).
- grant / team  -> ALREADY owned via `team_profiles` + `team_profile_members` (owner/editor/viewer).
                   Not rebuilt. The new model mirrors its vocabulary so grants can adopt it later.

So the new polymorphic ownership covers entityType in ('tool','album','field'). Grants keep their
existing members table; the invite mechanism is written so `team_profile_invites` can reuse it
(closes the open squatting question in project_ttp_grants_and_paths — see "team profile invites").

## The core safety rule (why two tables, not one)
A CLAIM IS NOT PROOF. A self-asserted claim must never expose or mutate data someone else entered.
So permission lives in a SEPARATE, trusted table that is only ever written after verification or an
admin decision. Mirrors app/me/team/profile/queries.ts: every private read/write innerJoins the
membership row, never a self-asserted claim.

- `listing_owners`  = the TRUSTED permission row. Presence = you may act. Every /me "your listings"
                      read and every edit action gates on THIS. Never created from a bare claim.
- `listing_claims`  = the REQUEST + audit trail. status pending|verified|rejected. A claim only
                      becomes a `listing_owners` row when auto-verified or admin-approved.
- `listing_invites` = owner-issued single-use token link (the invite Filip asked for). Accepting it
                      writes a `listing_owners` row. Token stored hashed; raw token only in the URL.

## Verification model (per entity type) — chosen, with why
Claiming an UNOWNED listing:
- field you submitted yourself (`submittedByUserId == you`): instant owner. You created the row;
  strongest possible signal, no extra proof needed.
- tool that is a GitHub repo (tool_links github/source, or a github.com url): **repo-file proof**.
  We generate a token, you commit a file `.frc-tools-verify` (or a line in README) containing it to
  the default branch, we fetch the raw file and match. RECOMMENDED for tools because it needs no new
  OAuth app, no server-side secrets, and works for any git host. GitHub-account-owner match (via a
  GitHub OAuth token) is a faster future path but needs a GitHub OAuth app we do not have tonight;
  noted as a follow, not built.
- everything else (albums, non-repo tools, fields you did not submit): **held for review**
  (claim stays pending, NO owner row) until an admin approves. Album description-token proof
  (put a token in the album description, we fetch and match) is a good future auto-path; noted.

Claiming an ALREADY-OWNED listing: never auto-succeeds. It becomes a held-for-review dispute, or the
existing owner sends an invite. This is what stops squatting getting worse across four entity types:
a second claimant NEVER silently gains access, and the first owner's data is never exposed to them.

Email-domain check: available as a method (`domain_email`) when a listing carries a contact email
whose domain matches the claimant's Firebase-verified email domain. Useful for albums/fields with a
contact; still weaker than repo proof, so it is auto-verify ONLY when the listing is unowned.

## What an owner may edit vs what still goes through moderation
Owner edits to DESCRIPTIVE fields apply directly (they own it), the same way saveTeamProfile applies
directly. Admin-only columns stay admin-only and are never in the owner form:
- tools: owner may edit name, summary, description, toolType, vendorName, links. NOT status,
  isOfficial, isVendor, scores, adminNotes, freshnessState.
- albums: owner may edit title, photographer, description, dateText. NOT status, eventId, provider.
- fields: owner may edit the FieldEditProposalData columns directly, bypassing the proposal queue.
  Anonymous / non-owner suggestions STILL go through field_edit_proposals unchanged (hard rule).

## Admin override
isAdmin (DB-only flag, never a Firebase claim) can approve/reject any claim, add/remove owners, and
transfer ownership. Resolves disputes and the team-profile dead-end. Admin actions record
`decidedByUserId`.

## Schema (new file packages/db/src/schema/listing-ownership.ts)
LISTING_ENTITY_TYPES = ['tool','album','field']
LISTING_OWNER_ROLES  = ['owner','editor','viewer']   (mirrors team profiles)
CLAIM_STATUSES       = ['pending','verified','rejected']
CLAIM_METHODS        = ['self_submitted','repo_file','domain_email','invite','admin','manual_review']

listing_owners(id, entityType, entityId, userId->users cascade, role, verifiedVia, invitedBy,
  createdAt; unique(entityType,entityId,userId); idx(userId); idx(entityType,entityId))
listing_claims(id, entityType, entityId, userId->users cascade, method, status,
  evidence jsonb, reviewerNote, decidedByUserId, decidedAt, createdAt;
  idx(status); idx(entityType,entityId); idx(userId))
listing_invites(id, entityType, entityId, role, tokenHash unique, invitedByUserId->users,
  email, expiresAt, usedAt, usedByUserId, createdAt; idx(entityType,entityId))

## Build progress (update as you go)
- [x] Design written (this file).
- [ ] schema/listing-ownership.ts + barrel export
- [ ] drizzle migration generated (NOT applied to prod — Filip's call)
- [ ] queries.ts: ownership reads (all gated on listing_owners)
- [ ] server actions: claim, verify-repo, accept-invite, create-invite, admin resolve, owner edits
- [ ] /me/listings UI + nav tab
- [ ] type-check clean, commits on branch

## Next concrete step
Write packages/db/src/schema/listing-ownership.ts, add to schema/index.ts barrel, then
`bun run db:generate` from packages/db (generate only, never migrate to prod).

## Open questions for Filip (do not block on these)
- GitHub OAuth app for account-owner tool verification (faster than repo-file). Not built tonight.
- Album description-token auto-verification. Not built tonight; albums default to held-for-review.
- Should `team_profile_invites` reuse this exact token mechanism now? Designed to; wiring the accept
  path into teamProfileMembers is a small follow if wanted.
