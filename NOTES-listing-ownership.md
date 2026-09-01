# Listing ownership: design and build notes

Branch `feat/listing-ownership`, worktree `.../ttp-worktrees/ownership`. Not merged, not deployed.

## Status: built and type-checking clean. Migration generated, NOT applied to prod.
`bun run type-check` passes across all 6 packages. Lint is not configured in this repo (next lint
prompts interactively), so type-check is the gate, same as the rest of the project. A full
`next build` was NOT run here: it needs the build-time DB over Tailscale that only the build server
has. The client/server boundary was checked by hand instead (see "bundle safety" below).

## The task
A signed-in user can CLAIM and then EDIT the listings they own, across every vertical: a tool, a
photo album, a practice field, an off-season event. Sign-in makes editing easier and never walls
off anonymous submit or suggest-edit.

## What "a listing" is per vertical
- tool           -> `tools` row. An off-season event is a tool with `toolType='offseason_event'`,
                    so it needs no separate entity type.
- photo album    -> `albums` row.
- practice field -> `practice_fields` row (already had nullable `submittedByUserId`, migration 0010).
- grant / team   -> ALREADY owned via `team_profiles` + `team_profile_members`. Not rebuilt. The new
                    model mirrors its owner/editor/viewer vocabulary so grants can adopt it later.

New polymorphic ownership covers entityType in ('tool','album','field').

## The claim / verification model chosen, and why
A CLAIM IS NOT PROOF. Permission lives in a separate trusted table (`listing_owners`) that is only
ever written after real proof or an admin decision. Every private read and every edit gates on that
row, never on a claim. Same discipline as app/me/team/profile/queries.ts.

Three tables (migration `0011_brown_luckman.sql`, packages/db/src/schema/listing-ownership.ts):
- `listing_owners`  the trusted permission row. Written ONLY by the single `grantOwnership()` choke
                    point in actions.ts, called from four proof/decision paths, never from a claim.
- `listing_claims`  the request and audit trail: who asked, method, status, evidence, who decided.
- `listing_invites` an owner-issued single-use token link. Token stored sha256-hashed; raw only in
                    the URL.

Verification paths when claiming an UNOWNED listing:
- field you submitted yourself (submittedByUserId == you): instant owner. Strongest signal, you made
  the row. Recommended and implemented.
- tool that is a GitHub repo: repo-file proof. We mint a token, you commit `.frc-tools-verify`
  containing it to the default branch (main or master), we fetch the raw file and match.
  RECOMMENDED for tools: needs no new OAuth app, no server secrets, works for any git host. The repo
  URL comes from the tool's OWN tool_links, not user input, so there is no SSRF and no way to point
  the fetch at an attacker host (parseGithubRepo also pins to github.com). Implemented.
- everything else (albums, non-repo tools, someone else's field): held for review. A pending claim,
  NO owner row, until an admin approves. Implemented.

Claiming an ALREADY-OWNED listing NEVER auto-grants. It becomes a pending dispute for an admin, or
the existing owner sends an invite. This is what stops squatting getting worse across four entity
types: a second claimant never silently gains access, and the first owner's data is never exposed.

Alternatives considered: GitHub-account-owner match via a GitHub OAuth token (faster UX, but needs a
GitHub OAuth app we do not have) and album description-token proof (put a token in the album
description, we fetch and match). Both are good future auto-paths; noted, not built. Email-domain
match exists as a method value for a future contact-email check; only ever auto-verify while unowned.

## What an owner may edit vs what stays moderated / admin-only
Owner (or editor) edits DESCRIPTIVE columns directly, like saveTeamProfile does. Admin-only columns
(status, isOfficial, scores, adminNotes, freshness, provider, eventId) are never in the forms and
never in the update sets.
- tool:  name, summary, description, vendorName, toolType.
- album: title, photographer, description, dateText.
- field: name, hours, contactInfo, contactUrl, website, notes. Location and equipment spec still go
  through field_edit_proposals, so a MOVE keeps its admin review; access details do not.
Anonymous submit and suggest-edit are untouched everywhere.

## Admin override
`adminResolveClaim` (isAdmin DB flag only, never a Firebase claim) approves or rejects any pending
claim. Approving an already-owned listing ADDS the claimant as a co-owner rather than switching
control. Surfaced as a review queue on /me/listings, shown only when user.isAdmin.

## What was built (files)
- packages/db/src/schema/listing-ownership.ts + barrel export; migration 0011.
- apps/web/lib/queries/listing-ownership.ts: all reads, every one gated on listing_owners.
- apps/web/app/me/listings/actions.ts: startClaim, verifyRepoClaim, createInvite, acceptInvite
  (atomic single-use), removeOwner, adminResolveClaim, saveTool/Album/FieldListing.
- apps/web/app/me/listings/: page (owned + claims + admin review), [type]/[id] edit page,
  claim/ page, invite/ page.
- apps/web/components/me/: owned-listings, pending-claims, listing-edit-form, listing-access-panel,
  listing-claim-review, claim-starter, invite-accepter, listing-labels.
- apps/web/components/auth/: claim-listing-button (wired into tool-detail and fields/[id]),
  signed-in-gate.
- "Your listings" tab added to me-shell.

## Bundle safety (checked by hand, since next build was not run here)
Every client component imports db/queries types with `import type` only (erased at compile). The one
value that was needed, TOOL_TYPES, is passed from the server edit page as a prop, because the db
schema barrel is server-only (drizzle-orm/pg-core). This mirrors the existing field-enums split.

## Open questions for Filip (do not block)
1. team_profile_invites: the grant open question. The `listing_invites` mechanism here is the answer
   in miniature. To close it, add a `team_profile_invites` table with the same shape (tokenHash,
   role, invitedByUserId, email, expiresAt, usedAt) and an accept action that inserts a
   teamProfileMembers row (claim-then-grant atomically, as acceptInvite already does). I did NOT
   build it tonight: it touches the grants privacy path where a leak was caught this session, and I
   would rather you eyeball that one. Small, isolated follow.
2. GitHub OAuth app for account-owner tool verification (faster than the repo file).
3. Album description-token auto-verification (albums are held-for-review for now).
4. Tool link editing by owners (add/remove tool_links) is not in the owner form yet; links are a
   separate table and the scraping pipeline owns them. Add later if wanted.
5. A "settled claims" history view: verified/rejected claims are filtered out of the /me/listings
   in-progress list. Fine for now.

## Migration apply (Filip's call, do not run without him)
`0011_brown_luckman.sql` only CREATEs the three new tables and their FKs/indexes. Touches nothing
existing. Apply with the same drizzle-kit migrate path the grants 0009/0010 used.
